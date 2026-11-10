export const kinds = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  investment_contribution: "Investment contribution",
  investment_withdrawal: "Investment withdrawal",
} as const;

export type Kind = keyof typeof kinds;
export const currencies = {
  IDR: "Indonesian rupiah", USD: "US dollar", SGD: "Singapore dollar", EUR: "Euro", GBP: "British pound",
  AUD: "Australian dollar", CAD: "Canadian dollar", CNY: "Chinese yuan", HKD: "Hong Kong dollar",
  INR: "Indian rupee", JPY: "Japanese yen", KRW: "South Korean won", MYR: "Malaysian ringgit",
  NZD: "New Zealand dollar", PHP: "Philippine peso", THB: "Thai baht", VND: "Vietnamese dong",
  AED: "UAE dirham", CHF: "Swiss franc", KWD: "Kuwaiti dinar",
} as const;
export type Currency = keyof typeof currencies;
export const defaultCurrency: Currency = "IDR";
export const isCurrency = (value: string): value is Currency => Object.hasOwn(currencies, value);
const minorDigits = (currency: Currency) => currency === "KWD" ? 3 : ["JPY", "KRW", "VND"].includes(currency) ? 0 : 2;
export const currencyLabel = (currency: Currency) => currency === "IDR" ? "Rp" : currency;
export const amountExample = (currency: Currency) => currency === "IDR" ? "125.000,50" : minorDigits(currency) === 0 ? "125,000" : "125.50";
export const majorAmount = (amount: number, currency: Currency) => amount / 10 ** minorDigits(currency);
export type AccountKind = "bank" | "wallet" | "cash" | "investment";
export type FieldType = "text" | "number" | "date" | "select" | "checkbox";
export type FieldValue = string | number | boolean;
// Saved demo accounts from before currency support use IDR.
export type FinanceBook = { id: string; name: string };
type BookRecord = { ledger_id?: string | null };
export type SavingsGoal = BookRecord & { id: string; name: string; currency: Currency; target_minor: number; reserved_minor: number; target_on: string | null };
export type Account = BookRecord & { id: string; name: string; kind: AccountKind; currency?: Currency; opening_minor: number; opening_date: string; archived: boolean };
export type Category = BookRecord & { id: string; name: string; applicable_kind: "income" | "expense"; color: string; archived: boolean };
export type Field = BookRecord & { id: string; label: string; field_type: FieldType; options: string[]; required: boolean; position: number; archived: boolean };
export type Entry = {
  id: string; occurred_on: string; kind: Kind; description: string; amount_minor: number; account_id: string;
  destination_account_id: string | null; category_id: string | null; notes: string;
  custom_values: Record<string, FieldValue>; reimbursable_minor: number; counterparty: string; due_on: string | null;
};
export type Receipt = { id: string; expense_id: string; account_id: string; received_on: string; amount_minor: number; notes: string };
export type Valuation = { id: string; investment_account_id: string; valued_on: string; value_minor: number };
export type Workspace = {
  finance_books: FinanceBook[];
  savings_goals: SavingsGoal[];
  accounts: Account[]; categories: Category[]; field_definitions: Field[];
  transactions: Entry[]; reimbursement_receipts: Receipt[]; investment_valuations: Valuation[];
};
export type Collection = keyof Workspace;
export type EntryDraft = Omit<Entry, "amount_minor" | "reimbursable_minor" | "custom_values" | "kind"> & {
  amount: string; reimbursable: string; custom: Record<string, string | boolean>; kind: string;
};

export const emptyWorkspace: Workspace = {
  finance_books: [], savings_goals: [], accounts: [], categories: [], field_definitions: [], transactions: [],
  reimbursement_receipts: [], investment_valuations: [],
};
const jakarta = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
const rupiah = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const otherCurrency = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const today = () => jakarta.format(new Date());
function formattedAmount(amount: number, currency: Currency) {
  const decimals = minorDigits(currency);
  const factor = 10 ** decimals;
  const absolute = Math.abs(amount);
  const fraction = absolute % factor;
  const whole = (currency === "IDR" ? rupiah : otherCurrency).format((absolute - fraction) / factor);
  if (currency === "IDR") return whole + (fraction ? "," + String(fraction).padStart(2, "0").replace(/0$/, "") : "");
  return whole + (decimals ? "." + String(fraction).padStart(decimals, "0") : "");
}
export const money = (amount: number, currency: Currency = defaultCurrency) => (amount < 0 ? "−" : "") + currencyLabel(currency) + "\u00a0" + formattedAmount(amount, currency);
export const amountText = (amount: number, currency: Currency = defaultCurrency) => amount ? (amount < 0 ? "-" : "") + formattedAmount(amount, currency) : "";
export function signed(amount: number, currency: Currency = defaultCurrency) {
  return (amount < 0 ? "−" : amount > 0 ? "+" : "") + money(Math.abs(amount), currency);
}
const monthFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const monthLabel = (month: string) => monthFormat.format(new Date(month + "-01T00:00:00Z"));
export const dayLabel = (day: string) => dayFormat.format(new Date(day + "T00:00:00Z"));
export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function parseDate(input: string): string | null {
  const clean = input.trim();
  const slash = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(clean);
  const date = slash ? slash[3] + "-" + slash[2].padStart(2, "0") + "-" + slash[1].padStart(2, "0") : clean;
  if (!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(date + "T00:00:00Z");
  return !Number.isNaN(+value) && value.toISOString().slice(0, 10) === date ? date : null;
}
export function parseMoney(input: string, currency: Currency = defaultCurrency): number | null {
  let clean = input.trim().replace(new RegExp("^" + (currency === "IDR" ? "(?:Rp|IDR)" : currency) + "\\s*", "i"), "");
  const decimals = minorDigits(currency);
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(clean)) clean = clean.replace(/,/g, "");
  else if (currency === "IDR") {
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean)) clean = clean.replace(/\./g, "");
    clean = clean.replace(",", ".");
  }
  if (!(decimals ? new RegExp("^\\d+(?:\\.\\d{1," + decimals + "})?$") : /^\d+$/).test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const digits = (whole + fraction.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > 16) return null;
  const value = BigInt(digits);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}
export function formatMoneyInput(input: string, currency: Currency) {
  const amount = parseMoney(input, currency);
  if (amount === null) return input;
  const digits = minorDigits(currency);
  const minor = String(amount).padStart(digits + 1, "0");
  return groupNumber(digits ? minor.slice(0, -digits) + "." + minor.slice(-digits) : minor);
}
function normalizedNumber(input: string) {
  return /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(input) ? input.replace(/,/g, "") : input.replace(",", ".");
}
export function groupNumber(input: string) {
  const plain = normalizedNumber(input.trim());
  return /^-?\d+(?:\.\d+)?$/.test(plain) ? plain.replace(/^(-?)(\d+)/, (_, sign, whole) => sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : input;
}
export const newId = () => crypto.randomUUID();
export const accountName = (workspace: Workspace, id: string) => workspace.accounts.find(account => account.id === id)?.name ?? "Unknown account";
export const accountCurrency = (account?: Account): Currency => account?.currency ?? defaultCurrency;
export const currencyForAccount = (workspace: Workspace, id: string) => accountCurrency(workspace.accounts.find(account => account.id === id));
function workspaceWithAccounts(workspace: Workspace, accounts: Account[]): Workspace {
  const accountIds = new Set(accounts.map(account => account.id));
  const transactions = workspace.transactions.filter(entry => accountIds.has(entry.account_id));
  const entryIds = new Set(transactions.map(entry => entry.id));
  return { ...workspace, accounts, transactions,
    reimbursement_receipts: workspace.reimbursement_receipts.filter(receipt => accountIds.has(receipt.account_id) && entryIds.has(receipt.expense_id)),
    investment_valuations: workspace.investment_valuations.filter(row => accountIds.has(row.investment_account_id)),
  };
}
export function workspaceForCurrency(workspace: Workspace, currency: Currency): Workspace {
  return workspaceWithAccounts(workspace, workspace.accounts.filter(account => accountCurrency(account) === currency));
}
export function workspaceForBook(workspace: Workspace, bookId: string): Workspace {
  const inBook = (row: BookRecord) => (row.ledger_id ?? "") === bookId;
  return workspaceWithAccounts({ ...workspace, savings_goals: workspace.savings_goals.filter(inBook),
    categories: workspace.categories.filter(inBook), field_definitions: workspace.field_definitions.filter(inBook) },
    workspace.accounts.filter(inBook));
}
export const categoryName = (workspace: Workspace, id: string | null) => workspace.categories.find(category => category.id === id)?.name ?? "Uncategorized";
export const needsDestination = (kind: string) => kind === "transfer" || kind.startsWith("investment_");
export const editableAccounts = (workspace: Workspace, kind: string, destination = false, currentId?: string | null) => workspace.accounts.filter(account => {
  const investment = destination ? kind === "investment_contribution" : kind === "investment_withdrawal";
  return (!account.archived || account.id === currentId) && (account.kind === "investment") === investment;
});
export const activeFields = (workspace: Workspace) => workspace.field_definitions.filter(field => !field.archived).toSorted((a, b) => a.position - b.position);

export function historicalAccounts(workspace: Workspace, draft: Pick<EntryDraft, "occurred_on" | "account_id" | "destination_account_id" | "kind">) {
  const date = parseDate(draft.occurred_on);
  return date ? workspace.accounts.filter(account => date < account.opening_date
    && (account.id === draft.account_id || needsDestination(draft.kind) && account.id === draft.destination_account_id)) : [];
}

export function blankDraft(workspace: Workspace, month: string, kind: Kind = "expense", preset?: string): EntryDraft {
  const date = today();
  const accountId = kind === "investment_withdrawal" ? preset : undefined;
  const destination = kind === "investment_contribution" ? preset ?? null : null;
  return {
    id: newId(), kind, occurred_on: date.startsWith(month) ? date : month + "-01",
    description: "", amount: "", account_id: accountId ?? editableAccounts(workspace, kind)[0]?.id ?? "",
    destination_account_id: destination, category_id: null, notes: "", custom: {}, reimbursable: "", counterparty: "", due_on: null,
  };
}
export function draftFrom(entry: Entry, currency: Currency = defaultCurrency): EntryDraft {
  const { amount_minor, reimbursable_minor, custom_values, ...rest } = entry;
  return {
    ...rest, amount: amountText(amount_minor, currency), reimbursable: amountText(reimbursable_minor, currency),
    custom: Object.fromEntries(Object.entries(custom_values).map(([key, value]) => [key, typeof value === "number" ? String(value) : value])),
  };
}
type Validation = { entry: Entry; errors?: undefined } | { entry?: undefined; errors: Record<string, string> };
export function validateEntry(workspace: Workspace, draft: EntryDraft): Validation {
  const errors: Record<string, string> = {};
  const existing = workspace.transactions.find(entry => entry.id === draft.id);
  const kind = Object.hasOwn(kinds, draft.kind) ? draft.kind as Kind : null;
  const date = parseDate(draft.occurred_on);
  const sourceAccount = editableAccounts(workspace, draft.kind, false, existing?.account_id).find(item => item.id === draft.account_id);
  const currency = accountCurrency(sourceAccount);
  const amount = parseMoney(draft.amount, currency);
  const description = draft.description.trim();
  const reimbursable = kind === "expense" && draft.reimbursable.trim() ? parseMoney(draft.reimbursable, currency) : 0;
  const destination = needsDestination(draft.kind) ? draft.destination_account_id : null;
  const due = reimbursable && draft.due_on ? parseDate(draft.due_on) : null;
  const counterparty = reimbursable ? draft.counterparty.trim() : "";
  const category = kind === "income" || kind === "expense" ? draft.category_id : null;
  if (!kind) errors.kind = "Choose a valid type.";
  if (!date) errors.occurred_on = "Enter a valid date (YYYY-MM-DD or DD/MM/YYYY).";
  if (!description || description.length > 160) errors.description = "Enter a description up to 160 characters.";
  if (!amount) errors.amount = "Enter a positive amount, such as " + amountExample(currency) + ".";
  const targetAccount = editableAccounts(workspace, draft.kind, true, existing?.destination_account_id).find(item => item.id === destination);
  if (!sourceAccount) errors.account_id = "Choose a valid account.";
  else if (existing && currencyForAccount(workspace, existing.account_id) !== currency) errors.account_id = "Keep the entry in its original currency.";
  else if (existing && (workspace.accounts.find(account => account.id === existing.account_id)?.ledger_id ?? null) !== (sourceAccount.ledger_id ?? null)) errors.account_id = "Keep the entry in its original sheet.";
  if (needsDestination(draft.kind)) {
    if (!targetAccount || destination === draft.account_id) errors.destination_account_id = "Choose a different destination account.";
    else if (accountCurrency(targetAccount) !== currency) errors.destination_account_id = "Choose a destination in the same currency.";
    else if ((targetAccount.ledger_id ?? null) !== (sourceAccount?.ledger_id ?? null)) errors.destination_account_id = "Choose a destination in the same sheet.";
  }
  if (category && !workspace.categories.some(item => item.id === category && item.applicable_kind === kind && (item.ledger_id ?? null) === (sourceAccount?.ledger_id ?? null) && (!item.archived || existing?.category_id === item.id))) errors.category_id = "Choose a category that matches this type and sheet.";
  if (reimbursable === null || reimbursable > (amount ?? 0)) errors.reimbursable = "The claim must be between zero and the expense amount.";
  if (reimbursable && !counterparty) errors.counterparty = "Enter who owes this reimbursement.";
  if (reimbursable && draft.due_on && (!due || (date && due < date))) errors.due_on = "Choose a due date on or after the expense date.";
  const receipts = workspace.reimbursement_receipts.filter(receipt => receipt.expense_id === draft.id);
  if ((reimbursable ?? 0) < total(receipts, row => row.amount_minor)) errors.reimbursable = "The claim cannot be less than the payments already received.";
  if (date && receipts.some(receipt => receipt.received_on < date)) errors.occurred_on = "The expense cannot move after a linked payment.";
  const customValues = { ...existing?.custom_values };
  for (const field of activeFields(workspace)) {
    const raw = draft.custom[field.id];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (field.field_type === "checkbox") {
      if (field.required && value !== true) errors[field.id] = "Select this checkbox.";
      customValues[field.id] = value === true;
    } else if (!value) {
      if (field.required) errors[field.id] = "Complete this field.";
      delete customValues[field.id];
    } else if (typeof value !== "string") {
      errors[field.id] = "Enter a valid value.";
    } else if (field.field_type === "number") {
      const plain = normalizedNumber(value);
      const number = /^-?\d+(?:\.\d+)?$/.test(plain) ? Number(plain) : NaN;
      if (!Number.isFinite(number)) errors[field.id] = "Enter a number.";
      else customValues[field.id] = number;
    } else if (field.field_type === "date") {
      const normalized = parseDate(value);
      if (!normalized) errors[field.id] = "Enter a valid date.";
      else customValues[field.id] = normalized;
    } else if (field.field_type === "select" && !field.options.includes(value) && existing?.custom_values[field.id] !== value) {
      errors[field.id] = "Choose a listed option.";
    } else {
      customValues[field.id] = value;
    }
  }
  if (Object.keys(errors).length || !kind || !date || !amount || reimbursable === null) return { errors };
  return { entry: {
    id: draft.id, kind, occurred_on: date, description, amount_minor: amount, account_id: draft.account_id,
    destination_account_id: destination, category_id: category, notes: draft.notes.trim(), custom_values: customValues,
    reimbursable_minor: reimbursable, counterparty, due_on: due,
  }};
}

const total = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0);
export function claims(workspace: Workspace, before = "9999-99-99", asOf = today()) {
  const receipts = new Map<string, Receipt[]>();
  for (const receipt of workspace.reimbursement_receipts) {
    if (receipt.received_on >= before) continue;
    const list = receipts.get(receipt.expense_id) ?? [];
    list.push(receipt);
    receipts.set(receipt.expense_id, list);
  }
  return workspace.transactions.filter(entry => entry.kind === "expense" && entry.reimbursable_minor && entry.occurred_on < before).map(entry => {
    const payments = (receipts.get(entry.id) ?? []).toSorted((a, b) => b.received_on.localeCompare(a.received_on));
    const paid = total(payments, receipt => receipt.amount_minor);
    const remaining = entry.reimbursable_minor - paid;
    const status = remaining === 0 ? "Settled" : paid > 0 ? "Partial" : "Pending";
    return { entry, receipts: payments, paid, remaining, status, overdue: !!(remaining && entry.due_on && entry.due_on < asOf) };
  });
}
export function balances(workspace: Workspace, before: string) {
  const openings = new Map(workspace.accounts.map(account => [account.id, account.opening_date]));
  const changes = new Map<string, number>();
  const sinceValuation = new Map<string, number>();
  const latest = new Map<string, Valuation>();
  for (const valuation of workspace.investment_valuations) {
    if (valuation.valued_on >= before) continue;
    const previous = latest.get(valuation.investment_account_id);
    if (!previous || previous.valued_on < valuation.valued_on) latest.set(valuation.investment_account_id, valuation);
  }
  const add = (id: string, date: string, delta: number) => {
    const opening = openings.get(id);
    if (opening && date >= opening) changes.set(id, (changes.get(id) ?? 0) + delta);
  };
  const adjust = (id: string, date: string, delta: number) => {
    const valuation = latest.get(id);
    if (valuation && date > valuation.valued_on) sinceValuation.set(id, (sinceValuation.get(id) ?? 0) + delta);
  };
  for (const entry of workspace.transactions) {
    if (entry.occurred_on >= before) continue;
    add(entry.account_id, entry.occurred_on, entry.kind === "income" ? entry.amount_minor : -entry.amount_minor);
    if (entry.destination_account_id) add(entry.destination_account_id, entry.occurred_on, entry.amount_minor);
    if (entry.kind === "investment_withdrawal") adjust(entry.account_id, entry.occurred_on, -entry.amount_minor);
    if (entry.kind === "investment_contribution" && entry.destination_account_id) adjust(entry.destination_account_id, entry.occurred_on, entry.amount_minor);
  }
  for (const receipt of workspace.reimbursement_receipts) if (receipt.received_on < before) add(receipt.account_id, receipt.received_on, receipt.amount_minor);
  return workspace.accounts.map(account => {
    const basis = (changes.get(account.id) ?? 0) + (account.opening_date < before ? account.opening_minor : 0);
    const valuation = latest.get(account.id);
    return { account, basis, valuation, value: valuation ? valuation.value_minor + (sinceValuation.get(account.id) ?? 0) : basis };
  });
}
export function monthly(data: Workspace, month: string, currency: Currency = defaultCurrency) {
  const workspace = workspaceForCurrency(data, currency);
  const before = shiftMonth(month, 1) + "-01";
  const accounts = balances(workspace, before);
  const entries = workspace.transactions.filter(entry => entry.occurred_on.startsWith(month)).toSorted((a, b) => b.occurred_on.localeCompare(a.occurred_on));
  const receipts = workspace.reimbursement_receipts.filter(row => row.received_on.startsWith(month));
  const activeClaims = claims(workspace, before, before < today() ? before : today());
  const expenses = entries.filter(entry => entry.kind === "expense");
  const income = total(entries.filter(entry => entry.kind === "income"), row => row.amount_minor);
  const gross = total(expenses, row => row.amount_minor);
  const spending = total(expenses, row => row.amount_minor - row.reimbursable_minor);
  const contribution = total(entries.filter(entry => entry.kind === "investment_contribution"), row => row.amount_minor);
  const withdrawal = total(entries.filter(entry => entry.kind === "investment_withdrawal"), row => row.amount_minor);
  const collected = total(receipts, row => row.amount_minor);
  const cash = total(accounts.filter(item => item.account.kind !== "investment"), row => row.value);
  const invested = total(accounts.filter(item => item.account.kind === "investment"), row => row.value);
  const receivable = total(activeClaims, row => row.remaining);
  const categoryTotals = new Map<string | null, number>();
  for (const entry of expenses) categoryTotals.set(entry.category_id, (categoryTotals.get(entry.category_id) ?? 0) + entry.amount_minor - entry.reimbursable_minor);
  const categories = Array.from(categoryTotals, ([id, amount]) => ({ id, name: categoryName(workspace, id), amount }))
    .filter(category => category.amount > 0).sort((a, b) => b.amount - a.amount);
  return { entries, receipts, income, gross, spending, contribution, withdrawal, collected, cash, invested, receivable, categories,
    cashIn: income + collected + withdrawal, cashOut: gross + contribution,
    netCashFlow: income + collected + withdrawal - gross - contribution,
    totalAssets: cash + invested + receivable, accounts, claims: activeClaims };
}

export type Activity = { id: string; date: string; title: string; kind: Kind | "reimbursement_receipt"; amount: number; accountId: string; category: string; entry?: Entry; receipt?: Receipt };
export function activity(workspace: Workspace, month: string, currency: Currency = defaultCurrency): Activity[] {
  const report = monthly(workspace, month, currency);
  return [
    ...report.entries.map(entry => ({
      id: entry.id, date: entry.occurred_on, title: entry.description, kind: entry.kind,
      amount: entry.kind === "income" || entry.kind === "investment_withdrawal" ? entry.amount_minor : entry.kind === "transfer" ? entry.amount_minor : -entry.amount_minor,
      accountId: entry.account_id, category: entry.category_id ? categoryName(workspace, entry.category_id) : kinds[entry.kind], entry,
    })),
    ...report.receipts.map(receipt => ({
      id: receipt.id, date: receipt.received_on, title: workspace.transactions.find(entry => entry.id === receipt.expense_id)?.description ?? "Reimbursement",
      kind: "reimbursement_receipt" as const, amount: receipt.amount_minor, accountId: receipt.account_id, category: "Reimbursement received", receipt,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
export const activityLabel = (row: Activity) => row.kind === "reimbursement_receipt" ? "Reimbursement received" : kinds[row.kind];
export const activityMoney = (row: Activity, currency: Currency = defaultCurrency) => row.kind === "transfer" ? money(row.amount, currency) : signed(row.amount, currency);
