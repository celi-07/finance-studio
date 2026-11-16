import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { emptyWorkspace } from "../lib/ledger.ts";
import { handleAssistant } from "../lib/ai-server.ts";
import { prepareWorkspacePreview, workspaceActionSchema } from "../lib/ai-workspace.ts";
import { prepareStatementDownload } from "../lib/statement.ts";

const env = { GEMINI_API_KEY: "server-key", GEMINI_FALLBACK_API_KEY: "backup-key", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" };
const account = (id, extra = {}) => ({ id, name: id, kind: "bank", currency: "IDR", opening_minor: 0, opening_date: "2020-01-01", archived: false, ...extra });
const workspace = () => ({ ...structuredClone(emptyWorkspace), accounts: [account("bank"), account("usd", { currency: "USD" }), account("investment", { kind: "investment" })] });
const request = () => new Request("https://finance-studio.example/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner.jwt" }, body: JSON.stringify({ messages: [{ role: "user", text: "Check my saved records" }], sheet_id: "", currency: "IDR" }) });
const call = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name, args, id: "call" }, thoughtSignature: "opaque" }] } }] });
const reply = text => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] });
const deps = (data, respond) => ({ authenticate: async () => ({ userId: "owner", workspace: data }), respond });
const change = (data, action) => prepareWorkspacePreview(data, "", { change: action });

test("authenticated default reader verifies email and loads fresh owner-scoped records after writes", async t => {
  const data = workspace(); let modelRound = 0, reservations = 0, reads = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(String(url));
    if (path.hostname === "fixture.supabase.co") {
      assert.equal(new Headers(options.headers).get("authorization"), "Bearer owner.jwt");
      if (path.pathname === "/auth/v1/user") return Response.json({ id: "owner", aud: "authenticated" });
      if (path.pathname.endsWith("/ledger_email_verified")) return Response.json(true);
      if (path.pathname.endsWith("/ledger_ai_reserve")) { reservations++; return Response.json(true); }
      assert.equal(options.method ?? "GET", "GET"); assert.equal(path.searchParams.get("user_id"), "eq.owner");
      reads++; return Response.json(data[path.pathname.split("/").at(-1)] ?? []);
    }
    assert.equal(path.hostname, "generativelanguage.googleapis.com");
    if (modelRound++ % 2 === 0) return Response.json(call("get_financial_report", { scope: "all", period: "all" }));
    const payload = JSON.parse(options.body);
    const report = payload.contents.at(-1).parts[0].functionResponse.response;
    const income = report.currencies.find(c => c.currency === "IDR").metrics.income.minor;
    return Response.json(reply("Saved income minor units: " + income + " [R1]"));
  });
  const first = await handleAssistant(request(), env); assert.equal(first.status, 200);
  assert.match((await first.json()).text, /units: 0/);
  data.transactions.push({ id: "new-saved-income", occurred_on: "2026-10-01", kind: "income", description: "Saved salary", amount_minor: 500000000, account_id: "bank", destination_account_id: null, category_id: null, notes: "", custom_values: {}, reimbursable_minor: 0, counterparty: "", due_on: null });
  const second = await handleAssistant(request(), env); assert.equal(second.status, 200);
  assert.match((await second.json()).text, /units: 500000000/);
  assert.equal(reservations, 2); assert.equal(reads, Object.keys(emptyWorkspace).length * 2);
});

test("unverified sessions and application rate limits never use Gemini or its fallback", async t => {
  let verified = false, quota = true; const paths = [];
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path === "/auth/v1/user") return Response.json({ id: "owner", aud: "authenticated" });
    if (path.endsWith("/ledger_email_verified")) return Response.json(verified);
    if (path.endsWith("/ledger_ai_reserve")) return Response.json(quota);
    throw Error("Private read or model request was not expected");
  });
  assert.equal((await handleAssistant(request(), env)).status, 403);
  assert.equal(paths.length, 2);
  verified = true; quota = false;
  assert.equal((await handleAssistant(request(), env)).status, 429);
  assert.equal(paths.length, 5);
});

test("AI requests a real report download with validated screen, currency, period and owned scope", async () => {
  let round = 0;
  const response = await handleAssistant(request(), env, deps(workspace(), async () => round++ ? reply("Your transaction PDF is being prepared.") : call("request_report_pdf", { kind: "transactions", currency: "IDR", period: "2026-10", scope: "sheet", sheet_id: null })));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).downloads, [{ kind: "transactions", currency: "IDR", period: "2026-10", scope: "sheet", sheet_id: "" }]);
});

test("multi-part verification can finish nine read steps within the existing fourteen-call budget", async () => {
  let round = 0;
  const response = await handleAssistant(request(), env, deps(workspace(), async () => round++ < 9 ? call("get_financial_report", { scope: "sheet", period: "2026-10" }) : reply("Verified saved records [R9]")));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).evidence.length, 9);
});

test("model quota failover keeps the configured backup model for subsequent tool rounds", async t => {
  const attempts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers["x-goog-api-key"], env.GEMINI_API_KEY);
    attempts.push(String(url));
    if (String(url).includes("gemini-3.5-flash:generateContent")) return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
    if (attempts.length === 2) return Response.json(call("get_financial_report", { scope: "all", period: "all" }));
    return Response.json(reply("Saved report [R1]"));
  });
  const { respondWithGemini } = await import("../lib/ai-server.ts");
  const response = await handleAssistant(request(), { ...env, GEMINI_FALLBACK_API_KEY: "", GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite" }, deps(workspace(), respondWithGemini));
  assert.equal(response.status, 200); assert.equal(attempts.length, 3);
  assert.ok(attempts.slice(1).every(url => url.includes("gemini-3.5-flash-lite:generateContent")));
});

test("unknown report sheets and unavailable currencies return tool errors instead of files", async () => {
  for (const proposal of [{ kind: "overview", currency: "IDR", period: "all", scope: "sheet", sheet_id: "someone-elses-sheet" }, { kind: "overview", currency: "EUR", period: "all", scope: "all", sheet_id: null }]) {
    let round = 0;
    const response = await handleAssistant(request(), env, deps(workspace(), async payload => {
      if (!round++) return call("request_report_pdf", proposal);
      assert.ok(payload.contents.at(-1).parts[0].functionResponse.response.error);
      return reply("Choose a saved sheet and currency.");
    }));
    assert.equal(response.status, 422); assert.match((await response.json()).error, /could not prepare/);
  }
});

test("existing statement renderer creates downloadable PDFs for all four report screens", async t => {
  t.mock.method(globalThis, "fetch", async path => new Response(readFileSync(new URL("../public" + path, import.meta.url))));
  for (const kind of ["overview", "transactions", "reimbursements", "investments"]) {
    const file = await prepareStatementDownload(workspace(), "all", "IDR", false, kind, "Personal");
    assert.match(file.filename, /^Finance Studio - (Overview|Transactions|Reimbursement|Investments) - \d+ \w+ \d{4}\.pdf$/);
    const bytes = Buffer.from(await file.blob.arrayBuffer());
    assert.ok(bytes.subarray(0, 8).toString().startsWith("%PDF-")); assert.ok(bytes.length > 1000);
  }
});

test("setup drafts generate trusted fields without writing data and reject injected owner fields", () => {
  const data = workspace(), before = structuredClone(data);
  const action = { type: "create_account", name: "New wallet", kind: "wallet", currency: "IDR", opening_balance: "1000000.50", opening_date: "2026-01-01" };
  const draft = change(data, action); assert.equal(draft.collection, "accounts");
  assert.equal(draft.rows[0].opening_minor, 100000050); assert.equal(draft.rows[0].ledger_id, null);
  assert.equal(draft.rows[0].user_id, undefined); assert.deepEqual(data, before);
  assert.throws(() => workspaceActionSchema.parse({ change: { ...action, user_id: "other-owner" } }));
  assert.throws(() => change(data, { ...action, name: "bank" }), /already exists/);
  assert.throws(() => change(data, { ...action, opening_balance: "-1" }), /valid/);
});

test("Gemini receives explicit action enums and cannot claim a preview after a rejected action", async () => {
  let round = 0;
  const response = await handleAssistant(request(), env, deps(workspace(), async payload => {
    if (!round++) {
      const schema = payload.tools[0].functionDeclarations.find(t => t.name === "prepare_workspace_preview").parametersJsonSchema;
      assert.equal(schema.properties.change.oneOf, undefined);
      assert.deepEqual(schema.properties.change.anyOf[0].properties.type.enum, ["create_account"]);
      assert.equal(schema.properties.change.anyOf[0].properties.type.const, undefined);
      return call("prepare_workspace_preview", { change: { type: "bank", name: "AI Test Bank", kind: "bank", currency: "IDR", opening_balance: "0", opening_date: "2026-10-01" } });
    }
    assert.match(payload.contents.at(-1).parts[0].functionResponse.response.error, /change.type/);
    return reply("I prepared your account preview. Approve it now.");
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /No changes were saved/);
});

test("custom-field tool schema declares saved keys and types and rejects invented fields", async () => {
  const data = workspace();
  data.field_definitions = [{ id: "reference", label: "AI Test Reference", field_type: "text", archived: false }, { id: "checked", label: "Reviewed", field_type: "checkbox", archived: false }, { id: "old", label: "Archived", field_type: "text", archived: true }];
  for (const valid of [true, false]) {
    let round = 0;
    const response = await handleAssistant(request(), env, deps(data, async payload => {
      if (!round++) {
        const schema = payload.tools[0].functionDeclarations.find(t => t.name === "prepare_transaction_preview").parametersJsonSchema.properties.entries.items.properties.custom;
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(Object.keys(schema.properties), ["reference", "checked"]);
        assert.equal(schema.properties.checked.type, "boolean");
        return call("prepare_transaction_preview", { entries: [{ kind: "income", occurred_on: "2026-10-02", description: "AI Test Salary", amount: "5000000", currency: "IDR", account_id: "bank", destination_account_id: null, category_id: null, custom: valid ? { reference: "E2E-2026", checked: true } : { invented: "ignored?" }, source: null, warnings: [] }], statement: null });
      }
      return reply("Review the drafts.");
    }));
    assert.equal(response.status, valid ? 200 : 422);
    if (valid) assert.deepEqual((await response.json()).previews[0].draft.custom, { reference: "E2E-2026", checked: true });
  }
});

test("configuration, goals and balance previews enforce sheet, account and date constraints", () => {
  const data = workspace();
  assert.equal(change(data, { type: "create_sheet", name: "Test business" }).collection, "finance_books");
  assert.equal(change(data, { type: "create_category", name: "Food", applicable_kind: "expense", color: "blue" }).collection, "categories");
  assert.equal(change(data, { type: "create_custom_field", label: "Reference", field_type: "text", required: false, options: [] }).collection, "field_definitions");
  assert.equal(change(data, { type: "set_savings_goal", id: null, name: "Emergency", currency: "IDR", target: "1000000", reserved: "100000", target_on: null }).rows[0].reserved_minor, 10000000);
  assert.equal(change(data, { type: "record_valuation", account_id: "investment", valued_on: "2026-10-01", value: "200000" }).rows[0].value_minor, 20000000);
  assert.equal(change(data, { type: "record_balance", account_id: "bank", recorded_on: "2026-10-01", frequency: "monthly", balance: "-100" }).rows[0].balance_minor, -10000);
  assert.throws(() => change(data, { type: "record_valuation", account_id: "bank", valued_on: "2026-10-01", value: "1" }), /investment account/);
  assert.throws(() => change(data, { type: "record_balance", account_id: "outside-sheet", recorded_on: "2026-10-01", frequency: "monthly", balance: "1" }), /current sheet/);
  assert.throws(() => change(data, { type: "record_balance", account_id: "bank", recorded_on: "2199-10-01", frequency: "monthly", balance: "1" }), /through today/);
});

test("partial combined reimbursement drafts validate every claim and allow a matching income link", () => {
  const data = workspace();
  data.transactions = [{ id: "dinner", occurred_on: "2026-10-01", kind: "expense", description: "Dinner", account_id: "bank", amount_minor: 27000000, reimbursable_minor: 16000000, counterparty: "", due_on: null, reimbursement_claims: [{ id: "sam", counterparty: "Sam", amount_minor: 10000000, due_on: "2026-10-20" }, { id: "alex", counterparty: "Alex", amount_minor: 6000000, due_on: "2026-10-20" }] }];
  const action = { type: "record_reimbursement_payment", account_id: "bank", received_on: "2026-10-02", income_entry_id: null, notes: "Partial combined receipt", allocations: [{ expense_id: "dinner", claim_id: "sam", amount: "50000" }, { expense_id: "dinner", claim_id: "alex", amount: "30000" }] };
  const preview = change(data, action); assert.equal(preview.rows.length, 2);
  assert.match(preview.detail, /Sam: Rp\s50\.000 for Dinner/); assert.match(preview.detail, /Alex: Rp\s30\.000 for Dinner/);
  assert.equal(preview.rows[0].payment_group_id, preview.rows[1].payment_group_id);
  assert.equal(preview.rows[0].id, preview.rows[0].payment_group_id, "the combined payment needs its own root row for the database foreign key");
  assert.throws(() => change(data, { ...action, account_id: "usd" }), /same currency/);
  assert.throws(() => change(data, { ...action, allocations: [{ expense_id: "dinner", claim_id: "sam", amount: "100001" }] }), /exceeds/);
  data.transactions.push({ id: "deposit", kind: "income", account_id: "bank", occurred_on: "2026-10-02", amount_minor: 8000000 });
  assert.throws(() => change(data, { ...action, income_entry_id: "deposit" }), /one claim at a time/);
  assert.equal(change(data, { ...action, allocations: [{ expense_id: "dinner", claim_id: "sam", amount: "80000" }], income_entry_id: "deposit" }).rows[0].income_entry_id, "deposit");
  data.reimbursement_receipts = preview.rows;
  const undo = change(data, { type: "undo_reimbursement_payment", receipt_id: preview.rows[0].id });
  assert.equal(undo.rows.length, 2); assert.equal(undo.remove.paymentGroup, preview.rows[0].payment_group_id);
});
