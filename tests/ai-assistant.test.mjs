import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, periodReport, validateFormEntry } from "../lib/ledger.ts";
import { loadCloud } from "../lib/ledger-cloud.ts";
import { financialReport, findTransactions, makePreviews, statementChecks } from "../lib/ai-finance.ts";
import { handleAssistant, respondWithGemini } from "../lib/ai-server.ts";

const account = (id, currency = "IDR", extra = {}) => ({ id, name: id, currency, kind: "bank", opening_minor: 0, opening_date: "2020-01-01", archived: false, ...extra });
const entry = (id, kind, amount_minor, extra = {}) => ({ id, kind, amount_minor, account_id: "bank", occurred_on: "2025-02-03", description: id, notes: "", category_id: null, destination_account_id: null, custom_values: {}, reimbursable_minor: 0, counterparty: "", due_on: null, ...extra });
const setup = () => ({ ...structuredClone(emptyWorkspace), accounts: [account("bank"), account("wallet", "IDR", { kind: "wallet" }), account("usd", "USD")] });
const proposal = (extra = {}) => ({ kind: "expense", occurred_on: "2025-02-03", description: "Lunch", amount: "12500.50", currency: "IDR", account_id: "bank", destination_account_id: null, category_id: null, notes: "", reimbursable: "", counterparty: "", due_on: null, custom: {}, source: null, warnings: [], ...extra });
const statement = (extra = {}) => ({ filename: "statement.pdf", currency: "IDR", opening_balance: "100000.00", closing_balance: "107499.50", total_debits: "12500.50", total_credits: "20000.00", transaction_count: 2, ...extra });
const env = { GEMINI_API_KEY: "server-only-test-key", SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const body = (extra = {}) => ({ messages: [{ role: "user", text: "Summarize everything since the first day" }], sheet_id: "", currency: "IDR", ...extra });
const request = (data = body(), headers = {}) => new Request("https://finance-studio.example/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner.jwt", ...headers }, body: typeof data === "string" ? data : JSON.stringify(data) });
const textResponse = text => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] });
const callResponse = (name, args, id = "call_1") => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name, args, id }, thoughtSignature: "opaque-test-signature" }] } }] });
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
  assert.equal((await handleAssistant(request(), { ...env, GEMINI_API_KEY: "" }, dependencies)).status, 503);
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
    assert.equal(key, "server-only-test-key");
    assert.equal(payload.model, "gemini-3.5-flash");
    assert.ok(payload.tools.flatMap(t => t.functionDeclarations).every(t => !/save|insert|update|delete|sql/.test(t.name)));
    if (!round++) return callResponse("get_financial_report", { scope: "all", period: "all" });
    const output = payload.contents.flatMap(c => c.parts).find(p => p.functionResponse).functionResponse.response;
    assert.ok(payload.contents.flatMap(c => c.parts).some(p => p.thoughtSignature === "opaque-test-signature"));
    assert.equal(output.currencies.find(c => c.currency === "IDR").metrics.income.minor, "100000");
    assert.equal(output.evidence_id, "R1"); return textResponse("Since 2020, recorded income is Rp 1.000. [R1]");
  }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.evidence[0].id, "R1"); assert.equal(result.previews, null);
  assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
});

test("PDF input is sent to the model and proposed drafts never write data", async () => {
  let round = 0; const data = setup(); const before = structuredClone(data);
  const file = { name: "statement.pdf", type: "application/pdf", data: btoa("%PDF-1.4\nfixture") };
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "Read my statement", attachments: [file] }] })), env, deps(data, async payload => {
    assert.ok(payload.contents[0].parts.some(p => p.inlineData?.mimeType === "application/pdf" && p.inlineData.data === file.data));
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
    assert.match(JSON.stringify(payload.contents.flatMap(c => c.parts).find(p => p.functionResponse).functionResponse.response), /filenames attached/);
    return textResponse("Please attach the document.");
  }));
  assert.equal((await response.json()).previews, null);
});

test("truncated model output and excessive tool loops fail without partial imports", async () => {
  const truncated = await handleAssistant(request(), env, deps(setup(), async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { role: "model", parts: [] } }] })));
  assert.equal(truncated.status, 502);
  let round = 0;
  const looping = await handleAssistant(request(), env, deps(setup(), async () => callResponse("unknown_tool", {}, `call_${round++}`)));
  assert.equal(looping.status, 422);
});

test("invalid user tokens fail before reading private records or invoking Gemini", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async url => {
    calls++; assert.ok(String(url).endsWith("/auth/v1/user"));
    return Response.json({ message: "Invalid token" }, { status: 401 });
  });
  assert.equal((await handleAssistant(request(), env)).status, 401);
  assert.equal(calls, 1);
});

test("exhausted Gemini quota gives an actionable error", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const path = String(url);
    if (path.includes("generativelanguage.googleapis.com")) return Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } }, { status: 429 });
    if (path.endsWith("/auth/v1/user")) return Response.json({ id: "owner", aud: "authenticated" });
    if (path.includes("ledger_email_verified") || path.includes("ledger_ai_reserve")) return Response.json(true);
    if (path.includes("/rest/v1/")) return Response.json([]);
    throw Error(`Unexpected endpoint ${path}`);
  });
  const response = await handleAssistant(request(), env, deps(setup(), respondWithGemini));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /quota.*billing/);
});

test("Gemini native requests use header authentication, inline PDFs and JSON-schema tools", async t => {
  const file = { name: "fictional.pdf", type: "application/pdf", data: btoa("%PDF-1.4 fixture") }; let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = String(url);
    if (path.includes("generativelanguage.googleapis.com")) {
      calls++;
      assert.equal(path, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
      assert.ok(!path.includes(env.GEMINI_API_KEY));
      assert.equal(options.headers["x-goog-api-key"], env.GEMINI_API_KEY);
      assert.equal(options.headers.Authorization, undefined);
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, undefined); assert.equal(payload.store, undefined);
      assert.equal(payload.toolConfig.functionCallingConfig.mode, "VALIDATED");
      assert.ok(payload.systemInstruction.parts[0].text.includes("Finance Studio"));
      assert.ok(payload.contents[0].parts.some(p => p.inlineData?.data === file.data));
      assert.ok(payload.tools[0].functionDeclarations.every(f => f.parametersJsonSchema.type === "object"));
      return Response.json(textResponse("I can read the fictional document."));
    }
    if (path.endsWith("/auth/v1/user")) return Response.json({ id: "owner", aud: "authenticated" });
    if (path.includes("ledger_email_verified") || path.includes("ledger_ai_reserve")) return Response.json(true);
    if (path.includes("/rest/v1/")) return Response.json([]);
    throw Error(`Unexpected endpoint ${path}`);
  });
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "Read this fictional PDF", attachments: [file] }] })), env, deps(setup(), respondWithGemini));
  assert.equal(response.status, 200); assert.equal(calls, 1);
});

test("parallel Gemini calls preserve thought signatures and match response IDs", async () => {
  const original = { role: "model", parts: [
    { thought: true, text: "Internal reasoning is not a user answer", thoughtSignature: "opaque-reasoning" },
    { functionCall: { id: "report", name: "get_financial_report", args: { scope: "all", period: "all" } }, thoughtSignature: "opaque-call" },
    { functionCall: { id: "details", name: "get_record_details", args: { scope: "sheet", collection: "savings_goals", offset: 0 } } },
  ] }; let round = 0;
  const response = await handleAssistant(request(), env, deps(setup(), async payload => {
    if (!round++) return { candidates: [{ finishReason: "STOP", content: original }] };
    assert.deepEqual(payload.contents.at(-2), original);
    const results = payload.contents.at(-1);
    assert.equal(results.role, "user");
    assert.deepEqual(results.parts.map(p => p.functionResponse.id), ["report", "details"]);
    assert.equal(results.parts[0].functionResponse.response.evidence_id, "R1");
    return { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ thought: true, text: "Private reasoning" }, { text: "Here is the report. [R1]" }] } }] };
  }));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.evidence.length, 2);
  assert.equal(result.text, "Here is the report. [R1]"); assert.ok(!JSON.stringify(result).includes("opaque-"));
});

test("Gemini safety blocks return no partial answer or drafts", async () => {
  const response = await handleAssistant(request(), env, deps(setup(), async () => ({ promptFeedback: { blockReason: "SAFETY" } })));
  assert.equal(response.status, 422); const result = await response.json(); assert.equal(result.previews, undefined);
});

test("consecutive assistant status messages become one Gemini model turn", async () => {
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "Prepare lunch" }, { role: "assistant", text: "Review the draft" }, { role: "assistant", text: "Saved one reviewed entry" }, { role: "user", text: "Summarize" }] })), env, deps(setup(), async payload => {
    assert.deepEqual(payload.contents.map(c => c.role), ["user", "model", "user"]);
    assert.equal(payload.contents[1].parts.length, 2); return textResponse("Ready");
  }));
  assert.equal(response.status, 200);
});

test("malformed Gemini tool output gets one bounded retry and is never executed", async () => {
  let calls = 0;
  const first = await handleAssistant(request(), env, deps(setup(), async payload => {
    calls++;
    if (calls === 1) return { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", content: { role: "model", parts: [] } }] };
    assert.ok(payload.systemInstruction.parts[0].text.includes("Do not repeat argument names"));
    return textResponse("A valid fictional reply");
  }));
  assert.equal(first.status, 200); assert.equal(calls, 2);
  calls = 0;
  const repeated = await handleAssistant(request(), env, deps(setup(), async () => { calls++; return { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }; }));
  assert.equal(repeated.status, 422); assert.equal(calls, 2);
});

test("quota failover uses the backup key for the full tool loop and hides both keys", async t => {
  const fallbackEnv = { ...env, GEMINI_FALLBACK_API_KEY: "backup-server-only-key" };
  const keys = []; let firstSignal;
  const file = { name: "fictional.pdf", type: "application/pdf", data: btoa("%PDF-1.4 fixture") };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(!String(url).includes("key="));
    const key = options.headers["x-goog-api-key"]; keys.push(key);
    firstSignal ??= options.signal; assert.equal(options.signal, firstSignal);
    const payload = JSON.parse(options.body);
    assert.ok(payload.contents[0].parts.some(p => p.inlineData?.data === file.data));
    if (key === env.GEMINI_API_KEY) return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
    if (keys.length === 2) return Response.json(callResponse("get_financial_report", { scope: "all", period: "all" }));
    assert.ok(payload.contents.at(-1).parts[0].functionResponse.response.evidence_id === "R1");
    return Response.json(textResponse("Fictional report [R1]"));
  });
  const response = await handleAssistant(request(body({ messages: [{ role: "user", text: "Summarize", attachments: [file] }] })), fallbackEnv, deps(setup(), respondWithGemini));
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(keys, [env.GEMINI_API_KEY, fallbackEnv.GEMINI_FALLBACK_API_KEY, fallbackEnv.GEMINI_FALLBACK_API_KEY]);
  assert.equal(result.evidence.length, 1);
  assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
  assert.ok(!JSON.stringify(result).includes(fallbackEnv.GEMINI_FALLBACK_API_KEY));
});

test("mid-tool quota failover restarts without stale signatures, previews or report evidence", async t => {
  const fallbackEnv = { ...env, GEMINI_FALLBACK_API_KEY: "backup-server-only-key" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; const payload = JSON.parse(options.body);
    if (calls === 1) return Response.json(callResponse("prepare_transaction_preview", { entries: [proposal()], statement: null }));
    if (calls === 2) return Response.json(callResponse("get_financial_report", { scope: "all", period: "all" }));
    if (calls === 3) {
      assert.ok(JSON.stringify(payload).includes("opaque-test-signature"));
      return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
    }
    assert.equal(options.headers["x-goog-api-key"], fallbackEnv.GEMINI_FALLBACK_API_KEY);
    if (calls === 4) {
      assert.equal(payload.contents.length, 1);
      assert.ok(!JSON.stringify(payload).includes("opaque-test-signature"));
      return Response.json(callResponse("get_financial_report", { scope: "all", period: "all" }));
    }
    assert.equal(payload.contents.at(-1).parts[0].functionResponse.response.evidence_id, "R1");
    return Response.json(textResponse("New fictional report [R1]"));
  });
  const response = await handleAssistant(request(), fallbackEnv, deps(setup(), respondWithGemini));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(calls, 5); assert.equal(result.previews, null); assert.equal(result.statement, null);
  assert.equal(result.evidence.length, 1); assert.equal(result.evidence[0].id, "R1");
});

test("both Gemini quotas exhausted stops after one failover with a safe error", async t => {
  const keys = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    keys.push(options.headers["x-goog-api-key"]);
    return Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "secret provider details" } }, { status: 429 });
  });
  const response = await handleAssistant(request(), { ...env, GEMINI_FALLBACK_API_KEY: "backup-key" }, deps(setup(), respondWithGemini));
  assert.equal(response.status, 429); assert.deepEqual(keys, [env.GEMINI_API_KEY, "backup-key"]);
  const result = await response.json(); assert.match(result.error, /quota.*billing/);
  assert.ok(!JSON.stringify(result).includes("secret provider details"));
});

test("a missing, blank or duplicate fallback key never retries an exhausted project", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++; return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
  });
  for (const fallback of ["", "   ", ` ${env.GEMINI_API_KEY} `]) {
    const response = await handleAssistant(request(), { ...env, GEMINI_FALLBACK_API_KEY: fallback }, deps(setup(), respondWithGemini));
    assert.equal(response.status, 429);
  }
  assert.equal(calls, 3);
});

test("primary success, configuration failures, capacity errors and safety blocks never fail over", async t => {
  let calls = 0, status = 200, safety = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(options.headers["x-goog-api-key"], env.GEMINI_API_KEY);
    return Response.json(status === 200 ? safety ? { promptFeedback: { blockReason: "SAFETY" } } : textResponse("Ready") : { error: { message: "Provider detail" } }, { status });
  });
  const fallbackEnv = { ...env, GEMINI_FALLBACK_API_KEY: "backup-key" };
  for (const [upstream, expected] of [[200, 200], [400, 502], [401, 503], [403, 503], [404, 503], [500, 502], [503, 503]]) {
    status = upstream;
    assert.equal((await handleAssistant(request(), fallbackEnv, deps(setup(), respondWithGemini))).status, expected);
  }
  status = 200; safety = true;
  assert.equal((await handleAssistant(request(), fallbackEnv, deps(setup(), respondWithGemini))).status, 422);
  assert.equal(calls, 8);
});

test("cancellation after a quota response prevents fallback requests", async t => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++; controller.abort();
    return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
  });
  const response = await handleAssistant(new Request(request(), { signal: controller.signal }), { ...env, GEMINI_FALLBACK_API_KEY: "backup-key" }, deps(setup(), respondWithGemini));
  assert.equal(response.status, 429); assert.equal(calls, 1);
});
