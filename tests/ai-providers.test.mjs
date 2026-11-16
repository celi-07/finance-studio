import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAssistant } from "../lib/ai-server.ts";
import { respondWithProvider } from "../lib/ai-providers.ts";
import { aiProviders, personalAIConfigSchema } from "../lib/ai-provider-config.ts";
import { emptyWorkspace } from "../lib/ledger.ts";

const env = { GEMINI_API_KEY: "site-key", GEMINI_FALLBACK_API_KEY: "site-fallback", GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite", SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const personal = (provider = "openai", apiKey = "personal-owner-A-secret-key") => ({ provider, model: aiProviders[provider].model, apiKey });
const request = (config, token = "owner-A.jwt", extra = {}) => new Request("https://finance.example/api/assistant", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ messages: [{ role: "user", text: "Summarize my records." }], sheet_id: "", currency: "IDR", ...(config ? { personalAI: config } : {}), ...extra }),
});
const reply = text => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] });
const dependencies = respond => ({ authenticate: async token => ({ userId: token.split(".")[0], workspace: structuredClone(emptyWorkspace) }), respond });
const upstream = (provider, parts, complete = true) => provider === "openai"
  ? { choices: [{ finish_reason: !complete ? "length" : parts.some(p => p.call) ? "tool_calls" : "stop", message: { content: parts.find(p => p.text)?.text ?? null,
    tool_calls: parts.filter(p => p.call).map(p => ({ id: p.id, type: "function", function: { name: p.call, arguments: JSON.stringify(p.args) } })),
  } }] }
  : { stop_reason: !complete ? "max_tokens" : parts.some(p => p.call) ? "tool_use" : "end_turn", content: parts.map(p => p.call ? { type: "tool_use", id: p.id, name: p.call, input: p.args } : { type: "text", text: p.text }) };

test("personal AI configuration rejects unknown providers, URLs, wrong models and header injection", () => {
  assert.ok(personalAIConfigSchema.safeParse(personal()).success);
  for (const config of [personal("openai", "short"), personal("openai", "secret-api-key\r\nInjected: header"), { ...personal(), provider: "proxy" }, { ...personal(), model: "https://evil.example" }, { ...personal(), model: "claude-sonnet-5-5" }, { ...personal(), baseURL: "https://evil.example" }]) {
    assert.equal(personalAIConfigSchema.safeParse(config).success, false);
  }
});

test("concurrent owners use only their own request key and workspace, and the next shared request inherits nothing", async () => {
  const calls = [];
  const deps = {
    authenticate: async token => ({ userId: token, workspace: { ...structuredClone(emptyWorkspace), accounts: [{ id: token, name: token, kind: "bank", currency: "IDR", opening_minor: 0, opening_date: "2026-01-01", archived: false }] } }),
    respond: async (body, key, signal, provider) => {
      await Promise.resolve();
      const metadata = body.systemInstruction.parts[0].text;
      if (key.includes("owner-A")) { assert.ok(metadata.includes("owner-A.jwt")); assert.ok(!metadata.includes("owner-B.jwt")); }
      if (key.includes("owner-B")) { assert.ok(metadata.includes("owner-B.jwt")); assert.ok(!metadata.includes("owner-A.jwt")); }
      assert.ok(!metadata.includes(key));
      assert.ok(!JSON.stringify(body).includes("apiKey"));
      calls.push([provider, key, body.model]); return reply("Your records are ready.");
    },
  };
  const responses = await Promise.all([handleAssistant(request(personal()), env, deps), handleAssistant(request(personal("anthropic", "personal-owner-B-secret-key"), "owner-B.jwt"), env, deps)]);
  for (const response of responses) { assert.equal(response.status, 200); assert.ok(!JSON.stringify(await response.json()).includes("secret-key")); }
  assert.equal((await handleAssistant(request(null), env, deps)).status, 200);
  assert.deepEqual(calls, [["openai", "personal-owner-A-secret-key", aiProviders.openai.model], ["anthropic", "personal-owner-B-secret-key", aiProviders.anthropic.model], ["gemini", "site-key", "gemini-3.5-flash"]]);
});

test("personal keys work without a shared key, but cannot bypass authentication or verification", async () => {
  let calls = 0;
  const deps = dependencies(async () => { calls++; return reply("Ready"); });
  const result = await handleAssistant(request(personal()), { ...env, GEMINI_API_KEY: "" }, deps);
  assert.equal(result.status, 200); assert.equal(calls, 1);
  calls = 0;
  const unauthenticated = request(personal()); unauthenticated.headers.delete("authorization");
  assert.equal((await handleAssistant(unauthenticated, env, deps)).status, 401);
  await handleAssistant(request(personal()), env, { ...deps, authenticate: async () => { throw Error("Unverified user"); } });
  assert.equal(calls, 0);
});

test("personal keys are rejected in the demo and malformed personal settings never use the shared key", async () => {
  let invoked = false;
  const deps = dependencies(async () => { invoked = true; return reply("Unexpected"); });
  assert.equal((await handleAssistant(request({ ...personal(), model: "https://proxy.example" }), env, deps)).status, 400);
  assert.equal((await handleAssistant(request(personal()), env, { ...deps, demo: true })).status, 400);
  assert.equal(invoked, false);
});

for (const provider of ["gemini", "openai", "anthropic"]) {
  test(`${provider} personal quota failures never fall back to site keys, other models or providers`, async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls++;
      assert.equal(options.headers[provider === "openai" ? "Authorization" : provider === "gemini" ? "x-goog-api-key" : "x-api-key"], (provider === "openai" ? "Bearer " : "") + personal(provider).apiKey);
      assert.ok(!JSON.stringify(options).includes("site-key"));
      return Response.json({ error: { message: "raw error containing secret-key" } }, { status: 429 });
    });
    const response = await handleAssistant(request(personal(provider)), env, dependencies(respondWithProvider));
    assert.equal(response.status, 429); assert.equal(calls, 1);
    const body = await response.text(); assert.ok(!body.includes("secret-key")); assert.ok(!body.includes("site owner"));
  });
}

for (const provider of ["openai", "anthropic"]) {
  test(`${provider} preserves tool IDs and attachments while application validation rejects invalid changes`, async t => {
    let calls = 0;
    const files = [
      { name: "fictional.pdf", type: "application/pdf", data: btoa("%PDF-1.4 fictional") },
      { name: "image.png", type: "image/png", data: btoa("\x89PNG\r\n\x1a\nfixture") },
      { name: "notes.csv", type: "text/csv", data: btoa("date,amount\n2026-01-01,50.50") },
    ];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls++;
      assert.equal(String(url), provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages");
      assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, personal(provider).model);
      assert.ok(!JSON.stringify(payload).includes(personal(provider).apiKey));
      assert.ok(JSON.stringify(payload).includes(files[0].data)); assert.ok(JSON.stringify(payload).includes(files[1].data)); assert.ok(JSON.stringify(payload).includes("2026-01-01,50.50"));
      assert.equal(payload.tools.length, 6);
      if (provider === "openai") assert.equal(payload.store, false);
      if (calls === 1) return Response.json(upstream(provider, [
        { id: "report-1", call: "get_financial_report", args: { scope: "all", period: "all" } },
        { id: "goal-1", call: "prepare_workspace_preview", args: { type: "savings_goal", title: "Test goal", target_amount: "100", reserved_amount: "0", currency: "IDR", target_date: null, notes: "" } },
      ]));
      if (provider === "openai") {
        const replies = payload.messages.filter(m => m.role === "tool");
        assert.deepEqual(replies.map(m => m.tool_call_id), ["report-1", "goal-1"]);
        assert.equal(JSON.parse(replies[0].content).evidence_id, "R1");
      } else {
        assert.deepEqual(payload.messages.at(-1).content.map(c => c.tool_use_id), ["report-1", "goal-1"]);
        assert.equal(JSON.parse(payload.messages.at(-1).content[0].content).evidence_id, "R1");
      }
      return Response.json(upstream(provider, [{ text: "Your saved report is ready. [R1]" }]));
    });
    const response = await handleAssistant(request(personal(provider), "owner-A.jwt", { messages: [{ role: "user", text: "Check my records and prepare a goal.", attachments: files }] }), env, dependencies(respondWithProvider));
    // The goal intentionally uses invalid arguments: the existing application validator must reject it.
    assert.equal(response.status, 422); assert.equal(calls, 2);
    assert.match((await response.json()).error, /could not prepare/);
  });

  test(`${provider} maps successful tool results to report evidence without leaking keys`, async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => Response.json(upstream(provider, ++calls === 1
      ? [{ id: "report", call: "get_financial_report", args: { scope: "all", period: "all" } }]
      : [{ text: "Your workspace has no saved transactions. [R1]" }])));
    const response = await handleAssistant(request(personal(provider)), env, dependencies(respondWithProvider));
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.evidence.length, 1); assert.equal(result.previews, null);
    assert.ok(!JSON.stringify(result).includes("personal-owner"));
  });

  test(`${provider} prepares valid entry reviews, setup changes and PDF requests without saving records`, async t => {
    let calls = 0;
    const workspace = { ...structuredClone(emptyWorkspace), accounts: [{ id: "bank", name: "Bank", kind: "bank", currency: "IDR", opening_minor: 0, opening_date: "2026-01-01", archived: false }] };
    const before = structuredClone(workspace);
    t.mock.method(globalThis, "fetch", async () => Response.json(upstream(provider, ++calls === 1 ? [
      { id: "entry", call: "prepare_transaction_preview", args: { entries: [{ kind: "expense", occurred_on: "2026-01-02", description: "Lunch", amount: "50.50", currency: "IDR", account_id: "bank", destination_account_id: null, category_id: null, source: null, warnings: [] }], statement: null } },
      { id: "setup", call: "prepare_workspace_preview", args: { change: { type: "create_sheet", name: "Business" } } },
      { id: "pdf", call: "request_report_pdf", args: { kind: "transactions", period: "all", currency: "IDR", scope: "sheet", sheet_id: null } },
    ] : [{ text: "Review your entry and new sheet. The app will prepare your PDF." }])));
    const response = await handleAssistant(request(personal(provider)), env, { ...dependencies(respondWithProvider), authenticate: async () => ({ userId: "owner-A", workspace }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.previews.length, 1); assert.equal(result.previews[0].draft.amount, "50.50");
    assert.equal(result.changes.length, 1); assert.equal(result.changes[0].collection, "finance_books");
    assert.equal(result.downloads.length, 1); assert.equal(result.downloads[0].kind, "transactions");
    assert.deepEqual(workspace, before);
  });

  test(`${provider} invalid keys, truncated replies, and broken tool JSON never yield partial drafts`, async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "secret-key" } }, { status: 401 }));
    let response = await handleAssistant(request(personal(provider)), env, dependencies(respondWithProvider));
    assert.equal(response.status, 422); assert.ok(!(await response.text()).includes("secret-key"));
    fetchMock.mock.mockImplementation(async () => Response.json(upstream(provider, [{ text: "Partial response" }], false)));
    response = await handleAssistant(request(personal(provider)), env, dependencies(respondWithProvider));
    assert.equal(response.status, 502); assert.equal((await response.json()).previews, undefined);
    if (provider === "openai") {
      fetchMock.mock.mockImplementation(async () => Response.json({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "bad", type: "function", function: { name: "prepare_transaction_preview", arguments: "{" } }] } }] }));
      response = await handleAssistant(request(personal(provider)), env, dependencies(respondWithProvider));
      assert.equal(response.status, 422); assert.equal((await response.json()).previews, undefined);
    }
  });
}
