import { accountCurrency, amountText, blankDraft, currencies, editableAccounts, isCurrency, parseDate, parseMoney, today, type Currency, type Workspace } from "./ledger";

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|yesterday|kemarin|today|hari ini)\b/iu;
const codes = Object.keys(currencies).join("|");
const amountPattern = new RegExp(String.raw`(?<![\p{L}\p{N}.,+\-])(?:(Rp|${codes}|\$)\s*)?(\d+(?:[.,]\d+)*)(?:\s*(rb|ribu|jt|juta|k|m|${codes})(?![\p{L}\p{N}]))?(?![\p{L}\p{N}.,])`, "giu");
const currencyCode = (token?: string) => {
  const upper = token?.toUpperCase() ?? "";
  return upper === "RP" ? "IDR" : upper === "$" ? "USD" : isCurrency(upper) ? upper : undefined;
};

export function quickEntry(workspace: Workspace, text: string, preferred: Currency, dateToday = today()) {
  const input = text.trim();
  if (!input || input.length > 280) throw Error("Describe one transaction in up to 280 characters.");
  if (/\b(transfer|withdraw|reimburse|tarik|pindah|invest)\b/iu.test(input)) throw Error("Use the form for transfers, reimbursements or investment movements.");
  const kind = /\b(received|earned|income|salary|gaji|pendapatan|terima)\b/iu.test(input) ? "income" : "expense";
  const dateToken = input.match(datePattern)?.[0];
  const relative = dateToken?.toLowerCase();
  const yesterday = new Date(Date.parse(dateToday + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const date = !dateToken || /^(today|hari ini)$/.test(relative ?? "") ? dateToday
    : /^(yesterday|kemarin)$/.test(relative ?? "") ? yesterday : parseDate(dateToken);
  if (!date) throw Error("Use a valid date, like 2026-11-10 or 10/11/2026.");
  const message = dateToken ? input.replace(dateToken, " ") : input;
  const accounts = editableAccounts(workspace, kind);
  const matches = accounts.flatMap(account => {
    const name = escapePattern(account.name.trim());
    const pattern = new RegExp("(?:^|\\s)(?:(?:from|via|using|with|pakai|dari)\\s+" + name + "(?=$|\\s)|" + name + "$)", "iu");
    const match = message.trim().match(pattern);
    return match ? [{ account, match: match[0] }] : [];
  }).sort((a, b) => b.account.name.length - a.account.name.length);
  const accountMatch = matches[0];
  const detail = accountMatch ? message.trim().replace(accountMatch.match, " ") : message;
  const amounts = [...detail.matchAll(amountPattern)];
  if (amounts.length !== 1) throw Error("Include one amount, like 27rb, Rp 27.000 or USD 14.50.");
  const [token, prefix, numeric, suffix] = amounts[0];
  const short = /^(rb|ribu|jt|juta|k|m)$/i.test(suffix ?? "") ? suffix.toLowerCase() : "";
  const firstCode = currencyCode(prefix);
  const lastCode = currencyCode(suffix);
  if (firstCode && lastCode && firstCode !== lastCode) throw Error("Use one currency for the amount.");
  const explicit = firstCode ?? lastCode ?? (/^(rb|ribu|jt|juta)$/.test(short) ? "IDR" : undefined);
  const eligible = accounts.filter(row => accountCurrency(row) === (explicit ?? preferred));
  const account = accountMatch?.account ?? (eligible.length === 1 ? eligible[0] : undefined);
  if (account && explicit && accountCurrency(account) !== explicit) throw Error("The amount and named account use different currencies.");
  const currency = explicit ?? (account ? accountCurrency(account) : preferred);
  if (!account) throw Error("Include the account name, such as “via Main bank”, so the draft uses the right currency.");
  let amount = parseMoney(numeric, currency);
  if (amount !== null && short) amount *= /^(jt|juta|m)$/.test(short) ? 1_000_000 : 1_000;
  if (!amount || !Number.isSafeInteger(amount)) throw Error("Enter a valid positive amount in " + currency + ".");
  let description = detail.replace(token, " ").replace(/^(?:beli|bayar|spent|paid|bought|received|earned|terima)\s+/iu, "")
    .replace(/\s+/g, " ").trim().replace(/\s+(?:on|pada|tanggal)$/iu, "").trim();
  description = description.replace(/^[\s,:]+|[\s,:]+$/g, "");
  const category = workspace.categories.find(row => !row.archived && row.applicable_kind === kind
    && new RegExp("(?:^|\\s)" + escapePattern(row.name) + "(?=\\s|$)", "iu").test(description));
  return {
    ...blankDraft(workspace, date.slice(0, 7), kind), occurred_on: date, account_id: account.id,
    amount: amountText(amount, currency), description, category_id: category?.id ?? null,
  };
}
