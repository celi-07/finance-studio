import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, periodReport, validateFormEntry } from "../lib/ledger.ts";
import { loadCloud } from "../lib/ledger-cloud.ts";
import { financialReport, findTransactions, makePreviews, statementChecks } from "../lib/ai-finance.ts";
import { handleAssistant } from "../lib/ai-server.ts";

const account = (id, currency = "IDR", extra = {}) => ({ id, name: id, currency, kind: "bank", opening_minor: 0, opening_date: "2020-01-01", archived: false, ...extra });
const entry = (id, kind, amount_minor, extra = {}) => ({ id, kind, amount_minor, account_id: "bank", occurred_on: "2025-02-03", description: id, notes: "", category_id: null, destination_account_id: null, custom_values: {}, reimbursable_minor: 0, counterparty: "", due_on: null, ...extra });
const setup = () => ({ ...structuredClone(emptyWorkspace), accounts: [account("bank"), account("wallet", "IDR", { kind: "wallet" }), account("usd", "USD")] });
const proposal = (extra = {}) => ({ kind: "expense", occurred_on: "2025-02-03", description: "Lunch", amount: "12500.50", currency: "IDR", account_id: "bank", destination_account_id: null, category_id: null, notes: "", reimbursable: "", counterparty: "", due_on: null, custom: {}, source: null, warnings: [], ...extra });
const statement = (extra = {}) => ({ filename: "statement.pdf", currency: "IDR", opening_balance: "100000.00", closing_balance: "107499.50", total_debits: "12500.50", total_credits: "20000.00", transaction_count: 2, ...extra });
const env = { OPENAI_API_KEY: "server-only-test-key", SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const body = (extra = {}) => ({ messages: [{ role: "user", text: "Summarize everything since the first day" }], sheet_id: "", currency: "IDR", ...extra });
const request = (data = body(), headers = {}) => new Request("https://finance-studio.example/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner.jwt", ...headers }, body: typeof data === "string" ? data : JSON.stringify(data) });
const textResponse = text => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });
const callResponse = (name, args, id = "call_1") => ({ status: "completed", output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }] });
const deps = (workspace = setup(), respond = async () => textResponse("Hello")) => ({ authenticate: async () => ({ userId: "owner", workspace }), respond });

test("all-history reports include old records and separate currencies and sheets", () => {
  const data = setup();
  data.finance_books = [{ id: "business", name: "Business" }];
  data.accounts.push(account("business-bank", "IDR", { ledger_id: "business" }));
  data.transactions = [entry("old", "income", 100000, { occurred_on: "2020-03-01" }), entry("new", "expense", 12500), entry("dollars", "income", 555, { account_id: "usd" }), entry("business", "income", 70000, { account_id: "business-bank" })];
  const all = financialReport(data, "", { scope: "all", period: "all" });
  assert.equal(all.first_recorded_date, "2020-01-01");
  assert.equal(all.currencies.find(c => c.currency === "IDR").metrics.income.minor, "170000");
  assert.equal(all.currencies.find(c => c.currency === "USD").metrics.income.minor, "555");
  assert.equal(all.currencies.find(c => c.currency === "IDR").by_year.find(y => y.year === "2020").income.minor, "100000");
  const personal = financialReport(data, "", { scope: "sheet", period: "all" });
  assert.equal(personal.currencies.find(c => c.currency === "IDR").metrics.income.minor, "100000");
});

test("reports count transfers, linked reimbursements and balance adjustments like the ledger", () => {
  const data = setup();
  data.transactions = [entry("salary", "income", 100000), entry("move", "transfer", 20000, { destination_account_id: "wallet" }), entry("meal", "expense", 12000, { reimbursable_minor: 7000, counterparty: "Sam" }), entry("deposit", "income", 3000, { occurred_on: "2025-02-04" })];
  data.reimbursement_receipts = [{ id: "paid", expense_id: "meal", income_entry_id: "deposit", account_id: "bank", amount_minor: 3000, received_on: "2025-02-04", notes: "" }];
  data.balance_updates = [{ id: "balance", account_id: "wallet", recorded_on: "2025-02-06", frequency: "weekly", balance_minor: 19000 }];
  const report = financialReport(data, "", { scope: "all", period: "all" }).currencies.find(c => c.currency === "IDR");
  assert.equal(report.metrics.income.minor, "100000");
  assert.equal(report.metrics.gross.minor, "13000");
  assert.equal(report.metrics.spending.minor, "6000");
  assert.equal(report.metrics.collected.minor, "3000");
  assert.equal(report.metrics.receivable.minor, "4000");
  assert.equal(report.metrics.cash.minor, "90000");
  assert.equal(report.transaction_count, 4);
  assert.equal(report.report_entry_count, 3);
  assert.equal(report.reimbursement_payment_count, 1);
  assert.equal(report.largest_expenses[0].gross_expense.minor, "12000");
  for (const [key, value] of Object.entries(report.metrics)) assert.equal(value.minor, String(periodReport(data, "all", "IDR")[key]));
});

test("unsafe totals fail instead of claiming exact precision", () => {
  const data = setup(); data.transactions = [entry("a", "income", Number.MAX_SAFE_INTEGER), entry("b", "income", 2)];
  assert.throws(() => financialReport(data, "", { scope: "all", period: "all" }), /precision/);
});

test("transaction search paginates and uses inclusive valid date ranges", () => {
  const data = setup(); data.transactions = Array.from({ length: 171 }, (_, i) => entry(String(i).padStart(3, "0"), "expense", 100));
  const query = { scope: "all", from: "2025-02-03", to: "2025-02-03", search: "", account_id: null, currency: "IDR", kind: "expense", offset: 0 };
  const first = findTransactions(data, "", query);
  assert.equal(first.total_matches, 171); assert.equal(first.rows.length, 80); assert.equal(first.next_offset, 80);
  assert.equal(findTransactions(data, "", { ...query, offset: 160 }).rows.length, 11);
  assert.equal(findTransactions(data, "", { ...query, offset: 160 }).next_offset, null);
  assert.throws(() => findTransactions(data, "", { ...query, from: "2025-02-30" }), /valid inclusive/);
});

test("cloud loading reads beyond the first 500 rows under the caller's owner filter", async () => {
  const calls = [];
  const client = { from(collection) { return { select() { return this; }, eq(column, owner) { assert.equal(column, "user_id"); assert.equal(owner, "owner-A"); return this; }, order(column) { assert.equal(column, "id"); return this; }, async range(start, end) { calls.push([collection, start, end]); const count = collection === "transactions" ? 1201 : 0; return { data: Array.from({ length: Math.max(0, Math.min(500, count - start)) }, (_, i) => ({ id: start + i })), error: null }; } }; } };
  const workspace = await loadCloud(client, "owner-A");
  assert.equal(workspace.transactions.length, 1201);
  assert.deepEqual(calls.filter(c => c[0] === "transactions").map(c => c[1]), [0, 500, 1000]);
});

test("previews preserve decimals, require ambiguous details and flag duplicate records", () => {
  const data = setup(); data.transactions = [entry("existing", "expense", 1250050, { description: "Lunch" })];
  const [valid, missing, wrongCurrency, fullClaim] = makePreviews(data, [proposal(), proposal({ occurred_on: null, account_id: null }), proposal({ currency: "USD" }), proposal({ reimbursable: "12500.50", counterparty: "Sam" })]);
  assert.deepEqual(valid.errors, {}); assert.deepEqual(valid.duplicates, ["existing"]);
  assert.equal(validateFormEntry(data, valid.draft, "none").entry.amount_minor, 1250050);
  assert.ok(missing.errors.occurred_on); assert.ok(missing.errors.account_id); assert.equal(missing.draft.occurred_on, "");
  assert.ok(wrongCurrency.errors.account_id); assert.deepEqual(fullClaim.errors, {});
  assert.throws(() => makePreviews(data, Array.from({ length: 151 }, () => proposal())), /150/);
});

test("invalid transfers and required custom fields stay blocked for review", () => {
  const data = setup(); data.field_definitions = [{ id: "reference", label: "Reference", field_type: "text", options: [], required: true, position: 0, archived: false }];
  const [transfer, missing] = makePreviews(data, [proposal({ kind: "transfer", destination_account_id: "usd" }), proposal()]);
  assert.ok(transfer.errors.destination_account_id);
  assert.ok(Object.keys(missing.errors).length);
});

test("statement reconciliation uses exact minor units and detects missing rows", () => {
  const data = setup();
  const proposals = [proposal({ source: { filename: "statement.pdf", page: 1, quote: "Lunch 12,500.50 DR" } }), proposal({ kind: "income", amount: "20000.00", source: { filename: "statement.pdf", page: 1, quote: "Deposit 20,000.00 CR" } })];
  const previews = makePreviews(data, proposals);
  assert.ok(statementChecks(previews, statement()).every(c => c.ok));
  const incomplete = statementChecks(previews.slice(0, 1), statement());
  assert.equal(incomplete.find(c => c.label === "Statement row count").ok, false);
  assert.equal(incomplete.find(c => c.label === "Closing balance").ok, false);
  assert.equal(statementChecks(previews, statement({ opening_balance: null, closing_balance: null, total_debits: null, total_credits: null, transaction_count: null }))[0].ok, false);
});

test("unauthenticated and cross-origin requests never reach the model", async () => {
  let invoked = false; const dependencies = deps(setup(), async () => { invoked = true; return textResponse("Unexpected"); });
  assert.equal((await handleAssistant(request(body(), { Authorization: "" }), env, dependencies)).status, 401);
  assert.equal((await handleAssistant(request(body(), { Origin: "https://attacker.example" }), env, dependencies)).status, 403);
  assert.equal(invoked, false);
});

test("unconfigured, malformed and invalid PDF requests fail before reading records", async () => {
  let authenticated = false;
  const dependencies = { ...deps(), authenticate: async () => { authenticated = true; throw Error("Should not run"); } };
  assert.equal((await handleAssistant(request(), { ...env, OPENAI_API_KEY: "" }, dependencies)).status, 503);
  assert.equal((await handleAssistant(request("{"), env, dependencies)).status, 400);
  assert.equal((await handleAssistant(request(body({ messages: [{ role: "user", text: "Import", attachments: [{ name: "bad.pdf", type: "application/pdf", data: btoa("not a PDF") }] }] })), env, dependencies)).status, 400);
  assert.equal(authenticated, false);
});

test("attachment limits apply across the entire conversation", async () => {
  const file = { name: "notes.txt", type: "text/plain", data: btoa("hello") };
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "First", attachments: [file, file, file] }, { role: "assistant", text: "Continue" }, { role: "user", text: "More", attachments: [file, file, file] }] })), env, deps());
  assert.equal(response.status, 413);
});

test("real tool loop returns exact report evidence and keeps provider keys server-side", async () => {
  const data = setup(); data.transactions = [entry("first", "income", 100000, { occurred_on: "2020-01-02" })]; let round = 0;
  const response = await handleAssistant(request(), env, deps(data, async (payload, key) => {
    assert.equal(key, "server-only-test-key"); assert.equal(payload.store, false);
    assert.ok(payload.include.includes("reasoning.encrypted_content"));
    assert.ok(payload.tools.every(t => !/save|insert|update|delete|sql/.test(t.name)));
    if (!round++) return callResponse("get_financial_report", { scope: "all", period: "all" });
    const output = JSON.parse(payload.input.find(i => i.type === "function_call_output").output);
    assert.equal(output.currencies.find(c => c.currency === "IDR").metrics.income.minor, "100000");
    assert.equal(output.evidence_id, "R1"); return textResponse("Since 2020, recorded income is Rp 1.000. [R1]");
  }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.evidence[0].id, "R1"); assert.equal(result.previews, null);
  assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
});

test("PDF input is sent to the model and proposed drafts never write data", async () => {
  let round = 0; const data = setup(); const before = structuredClone(data);
  const file = { name: "statement.pdf", type: "application/pdf", data: btoa("%PDF-1.4\nfixture") };
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "Read my statement", attachments: [file] }] })), env, deps(data, async payload => {
    assert.ok(payload.input[0].content.some(c => c.type === "input_file" && c.file_data.startsWith("data:application/pdf;base64,")));
    if (!round++) return callResponse("prepare_transaction_preview", { entries: [proposal({ source: { filename: file.name, page: 1, quote: "Lunch 12500.50" } })], statement: statement() });
    return textResponse("Review this draft before submitting.");
  }));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.previews.length, 1); assert.equal(result.previews[0].draft.amount, "12500.50");
  assert.deepEqual(data, before);
});

test("a correction replaces the preview rather than appending duplicate rows", async () => {
  let round = 0;
  const response = await handleAssistant(request(), env, deps(setup(), async () => {
    if (round++ === 0) return callResponse("prepare_transaction_preview", { entries: [proposal()], statement: null });
    if (round === 2) return callResponse("prepare_transaction_preview", { entries: [proposal({ amount: "20000" })], statement: null }, "call_2");
    return textResponse("Corrected draft.");
  }));
  const result = await response.json(); assert.equal(result.previews.length, 1); assert.equal(result.previews[0].draft.amount, "20000");
});

test("unknown tools and invented source filenames are rejected with no preview", async () => {
  let round = 0;
  const response = await handleAssistant(request(), env, deps(setup(), async payload => {
    if (round++ === 0) return callResponse("prepare_transaction_preview", { entries: [proposal({ source: { filename: "invented.pdf", page: 1, quote: "fake" } })], statement: null });
    assert.match(payload.input.find(i => i.type === "function_call_output").output, /filenames attached/);
    return textResponse("Please attach the document.");
  }));
  assert.equal((await response.json()).previews, null);
});

test("truncated model output and excessive tool loops fail without partial imports", async () => {
  const truncated = await handleAssistant(request(), env, deps(setup(), async () => ({ status: "incomplete", output: [] })));
  assert.equal(truncated.status, 502);
  let round = 0;
  const looping = await handleAssistant(request(), env, deps(setup(), async () => callResponse("unknown_tool", {}, `call_${round++}`)));
  assert.equal(looping.status, 422);
});

test("default authentication rejects invalid users and unverified sessions before provider access", async t => {
  let providerCalls = 0; let verified = false; let validUser = false;
  t.mock.method(globalThis, "fetch", async url => {
    const path = String(url);
    if (path.includes("api.openai.com")) { providerCalls++; throw Error("Should not call provider"); }
    if (path.endsWith("/auth/v1/user")) return Response.json(validUser ? { id: "owner", aud: "authenticated" } : { msg: "Invalid token" }, { status: validUser ? 200 : 401 });
    if (path.includes("ledger_email_verified")) return Response.json(verified);
    if (path.includes("ledger_ai_reserve")) return Response.json(false);
    throw Error(`Unexpected endpoint ${path}`);
  });
  assert.equal((await handleAssistant(request(), env)).status, 401);
  validUser = true; assert.equal((await handleAssistant(request(), env)).status, 403);
  verified = true; assert.equal((await handleAssistant(request(), env)).status, 429);
  assert.equal(providerCalls, 0);
});

test("empty provider credits give a clear availability error rather than suggesting a retry", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const path = String(url);
    if (path.includes("api.openai.com")) return Response.json({ error: { code: "credit_balance_exhausted", message: "No API credits remaining." } }, { status: 429 });
    if (path.endsWith("/auth/v1/user")) return Response.json({ id: "owner", aud: "authenticated" });
    if (path.includes("ledger_email_verified") || path.includes("ledger_ai_reserve")) return Response.json(true);
    if (path.includes("/rest/v1/")) return Response.json([]);
    throw Error(`Unexpected endpoint ${path}`);
  });
  const response = await handleAssistant(request(), env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /no credits/);
});
