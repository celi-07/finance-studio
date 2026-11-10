import { accountCurrency, amountText, blankDraft, currencies, editableAccounts, isCurrency, parseDate, parseMoney, today, type Currency, type EntryDraft, type Workspace } from "./ledger.ts";

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const monthNames = [
  "jan|january|januari", "feb|february|februari", "mar|march|maret", "apr|april", "may|mei", "jun|june|juni",
  "jul|july|juli", "aug|august|agu|agt|agustus", "sep|sept|september", "oct|october|okt|oktober",
  "nov|november", "dec|december|des|desember",
];
const names = monthNames.join("|");
const datePattern = new RegExp(String.raw`\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{1,2}\s+(?:${names})\b\.?(?:\s+\d{4})?|(?:${names})\s+\d{1,2}(?:,?\s+\d{4})?|yesterday|kemarin|today|hari ini)\b`, "iu");
const codes = Object.keys(currencies).join("|");
const amountPattern = new RegExp(String.raw`(?<![\p{L}\p{N}.,+\-])(?:(Rp|${codes}|\$)\s*)?(\d+(?:[.,]\d+)*)(?:\s*(rb|ribu|jt|juta|k|m|${codes})(?![\p{L}\p{N}]))?(?![\p{L}\p{N}.,])`, "giu");
const currencyCode = (token?: string) => {
  const upper = token?.toUpperCase() ?? "";
  return upper === "RP" ? "IDR" : upper === "$" ? "USD" : isCurrency(upper) ? upper : undefined;
};
type DraftKind = "income" | "expense";
export type QuickDraft = { draft: EntryDraft; currency: Currency };

function dateFrom(token: string, dateToday: string) {
  const relative = token.toLowerCase();
  if (relative === "today" || relative === "hari ini") return dateToday;
  if (relative === "yesterday" || relative === "kemarin") {
    return new Date(Date.parse(dateToday + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  }
  const parts = relative.replace(/[.,]/g, " ").trim().split(/\s+/);
  const month = monthNames.findIndex(names => names.split("|").includes(parts[0]) || names.split("|").includes(parts[1]));
  const day = /^\d+$/.test(parts[0]) ? parts[0] : parts[1];
  if (month >= 0 && day) return parseDate([parts[2] ?? dateToday.slice(0, 4), String(month + 1).padStart(2, "0"), day.padStart(2, "0")].join("-"));
  return parseDate(token);
}
function amountFrom(text: string, fallback: Currency) {
  const amounts = [...text.matchAll(amountPattern)];
  if (amounts.length !== 1) throw Error("Include one amount, such as 27rb, Rp 27.000, or USD 14.50.");
  const [token, prefix, numeric, suffix] = amounts[0];
  const short = /^(rb|ribu|jt|juta|k|m)$/i.test(suffix ?? "") ? suffix.toLowerCase() : "";
  const firstCode = currencyCode(prefix);
  const lastCode = currencyCode(suffix);
  if (firstCode && lastCode && firstCode !== lastCode) throw Error("Use one currency for the amount.");
  const explicit = firstCode ?? lastCode ?? (/^(rb|ribu|jt|juta)$/.test(short) ? "IDR" : undefined);
  const currency = explicit ?? fallback;
  let amount = parseMoney(numeric, currency);
  if (amount !== null && short) amount *= /^(jt|juta|m)$/.test(short) ? 1_000_000 : 1_000;
  if (!amount || !Number.isSafeInteger(amount)) throw Error("Enter a valid positive amount in " + currency + ".");
  return { token, amount: amountText(amount, currency), currency };
}
const named = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
const withoutConnector = (text: string) => text.replace(/\s*(?:\bdi tanggal|\btanggal|\bpada|\bdi|\bon)\s*$/iu, " ");

export function quickEntry(workspace: Workspace, text: string, preferred: Currency, dateToday = today()): QuickDraft {
  const input = text.trim();
  if (!input || input.length > 280) throw Error("Describe one transaction in up to 280 characters.");
  if (/\b(transfer|withdraw|reimburse|tarik|pindah|invest)\b/iu.test(input)) throw Error("Use the regular form for transfers, reimbursements or investment movements.");
  const kind: DraftKind = /\b(received|earned|income|salary|gaji|pendapatan|terima|pemasukan)\b/iu.test(input) ? "income" : "expense";
  const dateToken = datePattern.exec(input);
  const date = dateToken ? dateFrom(dateToken[0], dateToday) : dateToday;
  if (!date) throw Error("Use a valid date, such as 3 Okt 2026 or 03/10/2026.");
  const message = dateToken ? withoutConnector(input.slice(0, dateToken.index)) + " " + input.slice(dateToken.index + dateToken[0].length) : input;
  const accounts = editableAccounts(workspace, kind);
  const matches = accounts.flatMap(account => {
    const name = escapePattern(account.name.trim());
    const pattern = new RegExp("(?:^|\\s)(?:(?:from|via|using|with|pakai|dari|lewat)\\s+" + name + "(?=$|[\\s,.])|" + name + "$)", "iu");
    const match = message.trim().match(pattern);
    return match ? [{ account, match: match[0] }] : [];
  }).sort((a, b) => b.account.name.length - a.account.name.length);
  const accountMatch = matches[0];
  const detail = accountMatch ? message.trim().replace(accountMatch.match, " ") : message;
  const { token, amount, currency } = amountFrom(detail, accountMatch ? accountCurrency(accountMatch.account) : preferred);
  if (accountMatch && accountCurrency(accountMatch.account) !== currency) throw Error("The amount and named account use different currencies.");
  const eligible = accounts.filter(account => accountCurrency(account) === currency);
  const account = accountMatch?.account ?? (eligible.length === 1 ? eligible[0] : undefined);
  const description = detail.replace(token, " ").trim().replace(/^(?:beli|bayar|spent|paid|bought|received|earned|terima)\s+/iu, "")
    .replace(/\s+/g, " ").replace(/^[\s,:]+|[\s,:]+$/g, "");
  const category = workspace.categories.find(row => !row.archived && row.applicable_kind === kind
    && new RegExp("(?:^|\\s)" + escapePattern(row.name) + "(?=\\s|$)", "iu").test(description));
  return { currency, draft: {
    ...blankDraft(workspace, date.slice(0, 7), kind), occurred_on: date, account_id: account?.id ?? "",
    amount, description, category_id: category?.id ?? null,
  }};
}

export function reviseQuickEntry(workspace: Workspace, previous: QuickDraft, text: string, dateToday = today()): QuickDraft {
  const input = text.trim();
  const correction = /^(?:(?:ubah|ganti|change|set|update|revisi)\s+)?(?:the\s+)?(tanggal|date|jumlah|nominal|amount|akun|rekening|account|wallet|pakai|via|kategori|category|deskripsi|description|catatan|notes|tipe|type)\b[\s:]*(?:(?:to|ke|jadi|menjadi)\s+)?(.+)$/iu.exec(input);
  if (!correction) {
    if (/\b(beli|bayar|spent|paid|bought|received|earned|terima|gaji)\b/iu.test(input)) return quickEntry(workspace, input, previous.currency, dateToday);
    throw Error("Tell me which field to change, for example “ubah tanggal ke 4 Okt 2026” or “pakai BCA”.");
  }
  const field = correction[1].toLowerCase();
  const value = correction[2].trim();
  const { draft, currency } = previous;
  if (/^(tanggal|date)$/.test(field)) {
    const token = datePattern.exec(value)?.[0];
    const date = token ? dateFrom(token, dateToday) : null;
    if (!date) throw Error("Use a valid date, such as 4 Okt 2026.");
    return { currency, draft: { ...draft, occurred_on: date } };
  }
  if (/^(jumlah|nominal|amount)$/.test(field)) {
    const next = amountFrom(value, currency);
    return { currency: next.currency, draft: { ...draft, amount: next.amount, account_id: next.currency === currency ? draft.account_id : "" } };
  }
  if (/^(akun|rekening|account|wallet|pakai|via)$/.test(field)) {
    const account = editableAccounts(workspace, draft.kind).find(account => named(account.name, value));
    if (!account) throw Error("I couldn’t find that active account on this sheet.");
    if (accountCurrency(account) !== currency) throw Error("That account uses a different currency. Change the amount with its currency first.");
    return { currency, draft: { ...draft, account_id: account.id } };
  }
  if (/^(kategori|category)$/.test(field)) {
    const category = workspace.categories.find(row => !row.archived && row.applicable_kind === draft.kind && named(row.name, value));
    if (!category) throw Error("I couldn’t find that category for the current entry type.");
    return { currency, draft: { ...draft, category_id: category.id } };
  }
  if (/^(tipe|type)$/.test(field)) {
    const kind = /^(expense|pengeluaran)$/iu.test(value) ? "expense" : /^(income|pemasukan|pendapatan)$/iu.test(value) ? "income" : null;
    if (!kind) throw Error("Choose income or expense for an assistant draft.");
    return { currency, draft: { ...draft, kind, category_id: kind === draft.kind ? draft.category_id : null } };
  }
  return { currency, draft: { ...draft, [/^(catatan|notes)$/.test(field) ? "notes" : "description"]: value } };
}
