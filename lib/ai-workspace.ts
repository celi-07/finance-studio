import { z } from "zod";
import { currencySchema } from "./ai-contract.ts";
import { accountCurrency, balanceBeforeUpdate, claims, money, parseDate, parseMoney, today, workspaceForBook, type Collection, type Currency, type Workspace } from "./ledger.ts";

const name = z.string().trim().min(1).max(70);
const amount = z.string().max(40);
const date = z.string().refine(value => parseDate(value) === value, "Use an explicit YYYY-MM-DD date.");
const id = z.string().min(1).max(80);
export const workspaceActionSchema = z.object({ change: z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_account"), name, kind: z.enum(["bank", "wallet", "cash", "investment"]), currency: currencySchema, opening_balance: amount, opening_date: date }).strict(),
  z.object({ type: z.literal("create_sheet"), name }).strict(),
  z.object({ type: z.literal("create_category"), name, applicable_kind: z.enum(["income", "expense"]), color: z.enum(["green", "blue", "amber", "violet", "rose", "teal", "cyan", "indigo", "plum", "peach", "lime", "slate", "gold"]) }).strict(),
  z.object({ type: z.literal("create_custom_field"), label: name, field_type: z.enum(["text", "number", "date", "select", "checkbox"]), options: z.array(name).max(50), required: z.boolean() }).strict(),
  z.object({ type: z.literal("set_savings_goal"), id: id.nullable(), name, currency: currencySchema, target: amount, reserved: amount, target_on: date.nullable() }).strict(),
  z.object({ type: z.literal("record_valuation"), account_id: id, valued_on: date, value: amount }).strict(),
  z.object({ type: z.literal("record_balance"), account_id: id, recorded_on: date, frequency: z.enum(["weekly", "monthly"]), balance: amount }).strict(),
  z.object({ type: z.literal("record_reimbursement_payment"), account_id: id, received_on: date, income_entry_id: id.nullable(), allocations: z.array(z.object({ expense_id: id, claim_id: id, amount }).strict()).min(1).max(30), notes: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("undo_reimbursement_payment"), receipt_id: id }).strict(),
]) }).strict();
export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;
export type WorkspacePreview = { id: string; action: WorkspaceAction; collection: Collection; rows: Workspace[Collection]; title: string; detail: string; remove?: { id: string; paymentGroup?: string } };

function minor(value: string, currency: Currency, positive = false) {
  const parsed = parseMoney(value, currency);
  if (parsed === null || positive && parsed <= 0) throw Error("Use a valid " + currency + " amount" + (positive ? " greater than zero." : "."));
  return parsed;
}
function unique(rows: { name: string }[], value: string) {
  if (rows.some(row => row.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) throw Error("That name already exists in this sheet. Use the existing record or choose another name.");
}
export function prepareWorkspacePreview(workspace: Workspace, sheetId: string, input: unknown): WorkspacePreview {
  if (sheetId && !workspace.finance_books.some(book => book.id === sheetId)) throw Error("Choose one of your saved sheets.");
  const action = workspaceActionSchema.parse(input);
  const change = action.change;
  const sheet = workspaceForBook(workspace, sheetId);
  const ledger_id = sheetId || null;
  const preview = (collection: Collection, rows: Workspace[Collection], title: string, detail: string, remove?: WorkspacePreview["remove"]): WorkspacePreview => ({ id: crypto.randomUUID(), action, collection, rows, title, detail, ...(remove ? { remove } : {}) });
  const account = (accountId: string) => {
    const row = sheet.accounts.find(a => a.id === accountId && !a.archived);
    if (!row) throw Error("Choose an active saved account in the current sheet. Approve new account setup first.");
    return row;
  };
  if (change.type === "create_sheet") {
    unique([{ name: "Personal" }, ...workspace.finance_books], change.name);
    return preview("finance_books", [{ id: crypto.randomUUID(), name: change.name }], "Create sheet", change.name);
  }
  if (change.type === "create_account") {
    unique(sheet.accounts, change.name);
    const opening_minor = minor(change.opening_balance, change.currency);
    return preview("accounts", [{ id: crypto.randomUUID(), ledger_id, name: change.name, kind: change.kind, currency: change.currency, opening_minor, opening_date: change.opening_date, archived: false }], "Create account", `${change.name} · ${change.currency} · opening ${money(opening_minor, change.currency)} on ${change.opening_date}`);
  }
  if (change.type === "create_category") {
    unique(sheet.categories.filter(c => c.applicable_kind === change.applicable_kind), change.name);
    return preview("categories", [{ id: crypto.randomUUID(), ledger_id, name: change.name, applicable_kind: change.applicable_kind, color: change.color, archived: false }], "Create category", `${change.name} · ${change.applicable_kind}`);
  }
  if (change.type === "create_custom_field") {
    if (sheet.field_definitions.some(f => f.label.toLocaleLowerCase() === change.label.toLocaleLowerCase())) throw Error("That custom field already exists.");
    if (change.field_type === "select" && !change.options.length) throw Error("A select field needs at least one option.");
    return preview("field_definitions", [{ id: crypto.randomUUID(), ledger_id, label: change.label, field_type: change.field_type, options: change.field_type === "select" ? [...new Set(change.options)] : [], required: change.required, position: Math.max(-1, ...sheet.field_definitions.map(f => f.position)) + 1, archived: false }], "Create custom field", `${change.label} · ${change.field_type} · ${change.required ? "required" : "optional"}${change.field_type === "select" ? " · options: " + [...new Set(change.options)].join(", ") : ""}`);
  }
  if (change.type === "set_savings_goal") {
    const existing = change.id ? sheet.savings_goals.find(g => g.id === change.id) : null;
    if (change.id && !existing) throw Error("That savings goal is not in the current sheet.");
    if (existing && existing.currency !== change.currency) throw Error("Keep the saved goal’s currency.");
    if (!sheet.accounts.some(a => !a.archived && a.kind !== "investment" && accountCurrency(a) === change.currency)) throw Error("Create a cash account in this currency first.");
    if (!existing) unique(sheet.savings_goals, change.name);
    const target_minor = minor(change.target, change.currency, true), reserved_minor = minor(change.reserved, change.currency);
    return preview("savings_goals", [{ id: existing?.id ?? crypto.randomUUID(), ledger_id, name: change.name, currency: change.currency, target_minor, reserved_minor, target_on: change.target_on }], existing ? "Update savings goal" : "Create savings goal", `${change.name} · target ${money(target_minor, change.currency)} · set aside ${money(reserved_minor, change.currency)}${change.target_on ? " · due " + change.target_on : ""}`);
  }
  if (change.type === "record_valuation" || change.type === "record_balance") {
    const savedAccount = account(change.account_id), currency = accountCurrency(savedAccount);
    const day = change.type === "record_valuation" ? change.valued_on : change.recorded_on;
    if (day < savedAccount.opening_date || day > today()) throw Error("Choose a date from the account opening through today.");
    if (change.type === "record_valuation") {
      if (savedAccount.kind !== "investment") throw Error("Choose an investment account for a valuation.");
      const value_minor = minor(change.value, currency);
      const existing = sheet.investment_valuations.find(v => v.investment_account_id === savedAccount.id && v.valued_on === day);
      return preview("investment_valuations", [{ id: existing?.id ?? crypto.randomUUID(), investment_account_id: savedAccount.id, valued_on: day, value_minor }], "Record investment value", `${savedAccount.name} · ${day} · ${money(value_minor, currency)}`);
    }
    const negative = change.balance.startsWith("-");
    const balance_minor = minor(negative ? change.balance.slice(1) : change.balance, currency) * (negative ? -1 : 1);
    if (savedAccount.kind === "investment" && balance_minor < 0) throw Error("An investment balance cannot be negative.");
    const difference = balance_minor - balanceBeforeUpdate(sheet, savedAccount.id, day);
    if (!Number.isSafeInteger(difference)) throw Error("This balance difference is outside the supported precision.");
    const existing = sheet.balance_updates.find(v => v.account_id === savedAccount.id && v.recorded_on === day);
    return preview("balance_updates", [{ id: existing?.id ?? crypto.randomUUID(), account_id: savedAccount.id, recorded_on: day, frequency: change.frequency, balance_minor }], "Record ending balance", `${savedAccount.name} · ${day} · ending ${money(balance_minor, currency)} · adjustment ${money(difference, currency)}`);
  }
  if (change.type === "undo_reimbursement_payment") {
    const receipt = sheet.reimbursement_receipts.find(r => r.id === change.receipt_id);
    if (!receipt) throw Error("Choose a saved reimbursement payment in this sheet.");
    const rows = receipt.payment_group_id ? sheet.reimbursement_receipts.filter(r => r.payment_group_id === receipt.payment_group_id) : [receipt];
    const currency = accountCurrency(sheet.accounts.find(a => a.id === receipt.account_id));
    const total = rows.reduce((sum, row) => sum + row.amount_minor, 0);
    const details = rows.map(row => { const claim = claims(sheet).find(c => c.entry.id === row.expense_id && c.id === row.claim_id); return `${claim?.counterparty ?? "Claim"}: ${money(row.amount_minor, currency)}${claim ? " for " + claim.entry.description : ""}`; }).join("; ");
    return preview("reimbursement_receipts", rows, "Undo reimbursement payment", `${receipt.received_on} · ${money(total, currency)} · ${details}. This reopens the claims and reverses their receipt effect; linked income stays saved.`, { id: receipt.id, ...(receipt.payment_group_id ? { paymentGroup: receipt.payment_group_id } : {}) });
  }
  const deposit = account(change.account_id), currency = accountCurrency(deposit);
  if (deposit.kind === "investment") throw Error("Receive reimbursements into a cash account.");
  if (change.received_on > today()) throw Error("A reimbursement payment cannot be in the future.");
  const openClaims = claims(sheet), used = new Set<string>();
  const group = change.allocations.length > 1 ? crypto.randomUUID() : null;
  if (group && change.income_entry_id) throw Error("Link an existing income to one claim at a time. Combined payments must be recorded without an income link.");
  const rows = change.allocations.map((allocation, index) => {
    const claim = openClaims.find(c => c.entry.id === allocation.expense_id && c.id === allocation.claim_id);
    if (!claim || used.has(claim.key)) throw Error("Choose distinct saved reimbursement claims in this sheet.");
    used.add(claim.key);
    if (accountCurrency(sheet.accounts.find(a => a.id === claim.entry.account_id)) !== currency) throw Error("A receipt must use the same currency as its claim.");
    if (change.received_on < claim.entry.occurred_on) throw Error("A receipt cannot precede its expense.");
    const amount_minor = minor(allocation.amount, currency, true);
    if (amount_minor > claim.remaining) throw Error("This receipt exceeds the outstanding claim.");
    return { id: index === 0 && group ? group : crypto.randomUUID(), expense_id: claim.entry.id, claim_id: claim.id, payment_group_id: group, income_entry_id: change.income_entry_id, account_id: deposit.id, received_on: change.received_on, amount_minor, notes: change.notes };
  });
  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0);
  if (!Number.isSafeInteger(total)) throw Error("The payment total is outside the supported precision.");
  if (change.income_entry_id) {
    const income = sheet.transactions.find(e => e.id === change.income_entry_id && e.kind === "income");
    if (!income || income.account_id !== deposit.id || income.occurred_on !== change.received_on || income.amount_minor !== total) throw Error("A linked income must match this deposit account, date and total exactly.");
    if (sheet.reimbursement_receipts.some(r => r.income_entry_id === income.id)) throw Error("This income is already linked to a reimbursement payment.");
  }
  const details = rows.map(row => { const claim = openClaims.find(c => c.entry.id === row.expense_id && c.id === row.claim_id)!; return `${claim.counterparty}: ${money(row.amount_minor, currency)} for ${claim.entry.description}`; }).join("; ");
  return preview("reimbursement_receipts", rows, "Receive reimbursement", `${money(total, currency)} into ${deposit.name} on ${change.received_on}${change.income_entry_id ? " · linked to saved income" : ""} · ${details}`);
}
