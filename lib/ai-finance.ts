import { z } from "zod";
import {
  accountCurrency, accountName, categoryName, claims, inPeriod, money, parseMoney, parseDate, periodReport,
  today, validateFormEntry, workspaceForBook, type Workspace, type Currency,
} from "./ledger.ts";
import { MAX_PREVIEWS, type DraftPreview, type ProposedEntry, type Statement } from "./ai-contract.ts";

const requestedSheet = z.string().max(80).nullable().optional().describe("Saved sheet ID; null uses the current sheet, empty string selects Personal.");
export const reportQuerySchema = z.object({ scope: z.enum(["sheet", "all"]), sheet_id: requestedSheet, period: z.string().regex(/^(all|(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?)$/) });
export const searchQuerySchema = z.object({
  scope: z.enum(["sheet", "all"]), sheet_id: requestedSheet, from: z.string().nullable(), to: z.string().nullable(),
  search: z.string().max(200), account_id: z.string().nullable(), currency: z.string().nullable(),
  kind: z.string().nullable(), offset: z.number().int().min(0).max(1000000),
});
export const detailsQuerySchema = z.object({
  collection: z.enum(["reimbursement_claims", "reimbursement_receipts", "investment_valuations", "balance_updates", "savings_goals", "reimbursement_people"]),
  scope: z.enum(["sheet", "all"]), sheet_id: requestedSheet, offset: z.number().int().min(0).max(1000000),
});
function scopeData(data: Workspace, sheet: string, scope: "sheet" | "all", requested?: string | null) {
  const sheetId = requested ?? sheet;
  if (sheetId && !data.finance_books.some(book => book.id === sheetId)) throw Error("Choose one of your saved sheets.");
  return scope === "all" ? data : workspaceForBook(data, sheetId);
}
function safeMoney(value: number, currency: Currency) {
  if (!Number.isSafeInteger(value)) throw Error("This total exceeds the supported precision. Narrow the report before summarizing it.");
  return { minor: String(value), formatted: money(value, currency) };
}
export function financialReport(data: Workspace, sheet: string, input: z.infer<typeof reportQuerySchema>) {
  const { scope, period, sheet_id } = reportQuerySchema.parse(input);
  const workspace = scopeData(data, sheet, scope, sheet_id);
  const dates = [...workspace.transactions.map(e => e.occurred_on), ...workspace.accounts.map(a => a.opening_date),
    ...workspace.reimbursement_receipts.map(r => r.received_on), ...workspace.balance_updates.map(r => r.recorded_on),
    ...workspace.investment_valuations.map(r => r.valued_on)].sort();
  const currencyList = [...new Set(workspace.accounts.map(accountCurrency))].sort();
  return {
    scope: scope === "all" ? "All sheets" : data.finance_books.find(b => b.id === (sheet_id ?? sheet))?.name ?? "Personal",
    period, as_of: today(), first_recorded_date: dates[0] ?? null, last_recorded_date: dates.at(-1) ?? null,
    note: "Complete saved history; currencies are never added together. All time includes all saved dates, including any future-dated entries. Transfers are not income or spending. Personal spending excludes reimbursable portions. Income EXCLUDES deposits linked to reimbursements, and INCLUDES positive balance adjustments; explain those adjustments separately from earned income. Linked receipts settle claims without adding a second cash deposit. This describes recorded data, not activity missing from the ledger.",
    currencies: currencyList.map(currency => {
      const report = periodReport(workspace, period, currency);
      const metrics = Object.fromEntries((["income", "gross", "spending", "cash", "invested", "receivable", "totalAssets", "netCashFlow", "collected", "contribution", "withdrawal"] as const)
        .map(key => [key, safeMoney(report[key], currency)]));
      const byYear = period === "all" ? [...new Set(dates.map(date => date.slice(0, 4)))].map(year => {
        const row = periodReport(workspace, year, currency);
        return { year, income: safeMoney(row.income, currency), gross_expenses: safeMoney(row.gross, currency), personal_spending: safeMoney(row.spending, currency), net_cash_flow: safeMoney(row.netCashFlow, currency) };
      }) : [];
      return { currency,
        transaction_count: workspace.transactions.filter(e => accountCurrency(workspace.accounts.find(a => a.id === e.account_id)) === currency && inPeriod(e.occurred_on, period)).length,
        report_entry_count: report.entries.length, reimbursement_payment_count: report.receipts.length, balance_adjustment_count: report.adjustments.length,
        count_note: "Saved transaction count includes deposits linked to reimbursement payments; report entry count excludes those deposits to avoid counting income twice. Reimbursement payments and balance adjustments are separate records.",
        metrics, income_components: {
          recorded_income_excluding_linked_deposits: safeMoney(report.entries.filter(e => e.kind === "income").reduce((sum, e) => sum + e.amount_minor, 0), currency),
          positive_cash_balance_adjustments: safeMoney(report.adjustments.filter(a => !a.investment).reduce((sum, a) => sum + Math.max(0, a.difference), 0), currency),
          linked_reimbursement_deposits_excluded: safeMoney(workspace.transactions.filter(e => e.kind === "income" && inPeriod(e.occurred_on, period) && accountCurrency(workspace.accounts.find(a => a.id === e.account_id)) === currency && workspace.reimbursement_receipts.some(r => r.income_entry_id === e.id)).reduce((sum, e) => sum + e.amount_minor, 0), currency),
        }, by_year: byYear,
        largest_expenses: report.entries.filter(e => e.kind === "expense").toSorted((a, b) => b.amount_minor - a.amount_minor || a.id.localeCompare(b.id)).slice(0, 10)
          .map(e => ({ date: e.occurred_on, description: e.description, gross_expense: safeMoney(e.amount_minor, currency), personal_spending: safeMoney(e.amount_minor - e.reimbursable_minor, currency), account: accountName(workspace, e.account_id), category: categoryName(workspace, e.category_id) })),
        categories: report.categories.map(row => ({ name: row.name, personal_spending: safeMoney(row.amount, currency) })),
        accounts: report.accounts.map(row => ({ id: row.account.id, name: row.account.name, archived: row.account.archived, opening_date: row.account.opening_date, balance: safeMoney(row.value, currency), valuation_date: row.valuation?.valued_on ?? null })),
        outstanding_claims: report.claims.map(row => ({ description: row.entry.description, person: row.counterparty, remaining: safeMoney(row.remaining, currency) })),
      };
    }),
  };
}
export function findTransactions(data: Workspace, sheet: string, input: z.infer<typeof searchQuerySchema>) {
  const query = searchQuerySchema.parse(input);
  if (query.from && !parseDate(query.from) || query.to && !parseDate(query.to) || query.from && query.to && query.from > query.to) throw Error("Use valid inclusive dates in YYYY-MM-DD order.");
  const workspace = scopeData(data, sheet, query.scope, query.sheet_id);
  const needle = query.search.toLocaleLowerCase();
  const rows = workspace.transactions.filter(e => (!query.from || e.occurred_on >= query.from) && (!query.to || e.occurred_on <= query.to)
    && (!query.account_id || e.account_id === query.account_id || e.destination_account_id === query.account_id)
    && (!query.currency || accountCurrency(workspace.accounts.find(a => a.id === e.account_id)) === query.currency)
    && (!query.kind || e.kind === query.kind)
    && (!needle || [e.description, e.notes, e.counterparty, categoryName(workspace, e.category_id), ...Object.values(e.custom_values ?? {})].join(" ").toLocaleLowerCase().includes(needle)))
    .toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id));
  return { total_matches: rows.length, offset: query.offset, next_offset: query.offset + 80 < rows.length ? query.offset + 80 : null,
    rows: rows.slice(query.offset, query.offset + 80).map(e => ({ ...e, amount: money(e.amount_minor, accountCurrency(workspace.accounts.find(a => a.id === e.account_id))),
      account: accountName(workspace, e.account_id), category: categoryName(workspace, e.category_id) })) };
}
export function recordDetails(data: Workspace, sheet: string, input: z.infer<typeof detailsQuerySchema>) {
  const query = detailsQuerySchema.parse(input);
  const scoped = scopeData(data, sheet, query.scope, query.sheet_id);
  const rows = query.collection === "reimbursement_claims" ? claims(scoped).map(claim => ({ expense_id: claim.entry.id, claim_id: claim.id, description: claim.entry.description, counterparty: claim.counterparty, due_on: claim.due_on, currency: accountCurrency(scoped.accounts.find(a => a.id === claim.entry.account_id)), remaining_minor: claim.remaining, status: claim.status })) : scoped[query.collection];
  return { collection: query.collection, total: rows.length, offset: query.offset, next_offset: query.offset + 80 < rows.length ? query.offset + 80 : null, rows: rows.slice(query.offset, query.offset + 80) };
}
export function makePreviews(workspace: Workspace, proposals: ProposedEntry[]): DraftPreview[] {
  if (proposals.length > MAX_PREVIEWS) throw Error(`Review at most ${MAX_PREVIEWS} entries in one batch.`);
  return proposals.map(proposal => {
    const draft = { id: crypto.randomUUID(), kind: proposal.kind, occurred_on: proposal.occurred_on ?? "", description: proposal.description,
      amount: proposal.amount, account_id: proposal.account_id ?? "", destination_account_id: proposal.destination_account_id,
      category_id: proposal.category_id, notes: proposal.notes, reimbursable: proposal.reimbursable, counterparty: proposal.counterparty,
      due_on: proposal.due_on, custom: proposal.custom, people: proposal.people?.length ? proposal.people.map(person => ({ ...person, id: crypto.randomUUID() })) : undefined };
    const claimMode = draft.people?.length ? "split" : !proposal.reimbursable ? "none" : parseMoney(proposal.reimbursable, proposal.currency) === parseMoney(proposal.amount, proposal.currency) ? "full" : "partial";
    const errors = { ...validateFormEntry(workspace, draft, claimMode).errors };
    const account = workspace.accounts.find(a => a.id === draft.account_id);
    if (account && accountCurrency(account) !== proposal.currency) errors.account_id = "Choose an account in the statement’s currency.";
    const amount = parseMoney(draft.amount, proposal.currency);
    const duplicates = workspace.transactions.filter(e => e.account_id === draft.account_id && e.occurred_on === draft.occurred_on && e.amount_minor === amount
      && e.kind === draft.kind && e.description.trim().toLocaleLowerCase() === draft.description.trim().toLocaleLowerCase()).map(e => e.id);
    return { draft, currency: proposal.currency, source: proposal.source, warnings: proposal.warnings, errors, duplicates };
  });
}
export function statementChecks(previews: DraftPreview[], statement: Statement | null) {
  if (!statement) return [];
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  const relevant = previews.filter(p => p.source?.filename === statement.filename);
  if (statement.transaction_count !== null) checks.push({ label: "Statement row count", ok: relevant.length === statement.transaction_count, detail: `${relevant.length} preview rows / ${statement.transaction_count} stated transactions` });
  let debits = BigInt(0), credits = BigInt(0);
  for (const p of relevant) {
    const amount = parseMoney(p.draft.amount, statement.currency);
    if (p.currency !== statement.currency || amount === null || !["expense", "income"].includes(p.draft.kind)) return [...checks, { label: "Statement totals", ok: false, detail: "Reconciliation needs amounts in the statement currency and income/expense rows. Review transfers separately." }];
    if (p.draft.kind === "income") credits += BigInt(amount); else debits += BigInt(amount);
  }
  const display = (value: bigint) => Number.isSafeInteger(Number(value)) ? money(Number(value), statement.currency) : value.toString() + " minor units";
  for (const [label, value, computed] of [["Total debits", statement.total_debits, debits], ["Total credits", statement.total_credits, credits]] as const) {
    const expected = value === null ? null : parseMoney(value, statement.currency);
    if (expected !== null) checks.push({ label, ok: BigInt(expected) === computed, detail: `${display(computed)} extracted / ${money(expected, statement.currency)} on statement` });
  }
  const opening = statement.opening_balance === null ? null : parseSigned(statement.opening_balance, statement.currency);
  const closing = statement.closing_balance === null ? null : parseSigned(statement.closing_balance, statement.currency);
  if (opening !== null && closing !== null) {
    const computed = BigInt(opening) + credits - debits;
    checks.push({ label: "Closing balance", ok: computed === BigInt(closing), detail: `${display(computed)} calculated / ${money(closing, statement.currency)} on statement` });
  }
  if (!checks.length) checks.push({ label: "Statement reconciliation", ok: false, detail: "The source did not provide usable totals. Check every row against the document." });
  return checks;
}
function parseSigned(value: string, currency: Currency) {
  const negative = value.startsWith("-"); const amount = parseMoney(negative ? value.slice(1) : value, currency);
  return amount === null ? null : negative ? -amount : amount;
}
