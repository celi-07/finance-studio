import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { handleDemoAssistant } from "../lib/ai-demo-server.ts";
import { createAIDemo, demoActions, SAMPLE_PDF_NAME } from "../lib/ai-demo.ts";
import sample from "../lib/ai-demo-statement.json" with { type: "json" };

const env = { GEMINI_API_KEY: "server-only-demo-secret", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" };
const request = (body, headers = {}) => new Request("https://finance-studio.example/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const reply = text => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] });
const call = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name, args, id: "call" }, thoughtSignature: "opaque" }] } }] });
const defaults = extra => ({ reserve: async () => true, respond: async () => reply("A fictional demo reply"), ...extra });

test("public demo rejects arbitrary prompts, uploaded files, records and unknown scenarios", async () => {
  let called = false; const deps = defaults({ reserve: async () => { called = true; return true; }, respond: async () => { called = true; return reply("Unexpected"); } });
  for (const body of [
    { action: "summary", messages: [{ role: "user", text: "PRIVATE BANK RECORD" }] },
    { action: "statement", attachments: [{ name: "private.pdf", data: "PRIVATE" }] },
    { action: "summary", workspace: { transactions: [{ description: "PRIVATE" }] } },
    { action: "summary", previews: [{ description: "PRIVATE LOCAL EDIT" }] },
    { action: "arbitrary-action" },
  ]) assert.equal((await handleDemoAssistant(request(body), env, deps)).status, 400);
  assert.equal(called, false);
});

test("demo works without sign-in and reports only the fixed fictional ledger", async () => {
  let round = 0; const fixed = createAIDemo();
  const response = await handleDemoAssistant(request({ action: "summary" }, { Authorization: "Bearer PRIVATE_USER_TOKEN" }), env, defaults({ respond: async payload => {
    const input = JSON.stringify(payload); assert.ok(!input.includes("PRIVATE_USER_TOKEN"));
    assert.equal(payload.contents[0].parts[0].text, demoActions.summary.prompt);
    assert.ok(input.includes("fictional")); assert.ok(input.includes(fixed.accounts[0].name));
    if (!round++) return call("get_financial_report", { scope: "all", period: "all" });
    const report = payload.contents.at(-1).parts[0].functionResponse.response;
    assert.equal(report.first_recorded_date, "2020-01-01");
    assert.equal(report.currencies.find(c => c.currency === "IDR").metrics.income.minor, "700000000");
    return reply("The fictional history starts in 2020. [R1]");
  } }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.evidence.length, 1); assert.equal(result.userText, demoActions.summary.prompt);
  assert.ok(result.state.includes(".")); assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
});

test("only the packaged PDF is sent and it matches the public download", async () => {
  const downloaded = readFileSync(new URL("../public/" + SAMPLE_PDF_NAME, import.meta.url));
  assert.deepEqual(downloaded, Buffer.from(sample.data, "base64"));
  const response = await handleDemoAssistant(request({ action: "statement" }), env, defaults({ respond: async payload => {
    const parts = payload.contents[0].parts;
    assert.ok(parts.some(p => p.inlineData?.data === sample.data && p.inlineData.mimeType === "application/pdf"));
    assert.ok(parts.some(p => p.text?.includes(SAMPLE_PDF_NAME))); return reply("Sample statement read");
  } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).sampleAttached, true);
});

test("signed conversations carry only server-generated context and reject tampering", async () => {
  const first = await (await handleDemoAssistant(request({ action: "dinner" }), env, defaults())).json();
  let called = false;
  const bad = first.state.replace(first.state[0], first.state[0] === "a" ? "b" : "a");
  const rejected = await handleDemoAssistant(request({ action: "correction", state: bad }), env, defaults({ reserve: async () => { called = true; return true; } }));
  assert.equal(rejected.status, 400); assert.equal(called, false);
  const next = await handleDemoAssistant(request({ action: "correction", state: first.state }), env, defaults({ respond: async payload => {
    const text = JSON.stringify(payload.contents);
    assert.ok(text.includes(demoActions.dinner.prompt)); assert.ok(text.includes("A fictional demo reply"));
    assert.ok(text.includes(demoActions.correction.prompt)); return reply("Updated fictional example");
  } }));
  assert.equal(next.status, 200);
});

test("expired conversations are rejected before quota reservation or model access", async () => {
  const now = 1000000;
  const first = await (await handleDemoAssistant(request({ action: "summary" }), env, defaults({ now: () => now }))).json();
  let called = false;
  const response = await handleDemoAssistant(request({ action: "summary", state: first.state }), env, defaults({ now: () => now + 3600001, reserve: async () => { called = true; return true; } }));
  assert.equal(response.status, 400); assert.equal(called, false);
});

test("a conversation stops after eight live turns", async () => {
  let state; let calls = 0;
  const deps = defaults({ respond: async () => { calls++; return reply("Fictional response"); } });
  for (let i = 0; i < 8; i++) {
    const response = await handleDemoAssistant(request({ action: "summary", state }), env, deps);
    assert.equal(response.status, 200); state = (await response.json()).state;
  }
  assert.equal((await handleDemoAssistant(request({ action: "summary", state }), env, deps)).status, 422);
  assert.equal(calls, 8);
});

test("the only default database call is a public counter RPC with an opaque visitor hash", async t => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    count++;
    assert.equal(String(url), env.SUPABASE_URL + "/rest/v1/rpc/ledger_ai_demo_reserve");
    assert.equal(options.method, "POST");
    const args = JSON.parse(options.body); assert.match(args.p_visitor_hash, /^[a-f0-9]{64}$/);
    assert.ok(!options.body.includes("203.0.113.10")); assert.ok(!JSON.stringify(options).includes(env.GEMINI_API_KEY));
    return Response.json(false);
  });
  const response = await handleDemoAssistant(request({ action: "summary" }, { "x-vercel-forwarded-for": "203.0.113.10", Authorization: "Bearer PRIVATE_JWT" }), env);
  assert.equal(response.status, 429); assert.equal(count, 1);
});

test("rate limits block generation and key-based visitor hashes do not expose network addresses", async () => {
  let hash; let generated = false;
  const response = await handleDemoAssistant(request({ action: "summary" }, { "x-vercel-forwarded-for": "203.0.113.22" }), env, defaults({ reserve: async value => { hash = value; return false; }, respond: async () => { generated = true; return reply("Unexpected"); } }));
  assert.equal(response.status, 429); assert.match(hash, /^[a-f0-9]{64}$/); assert.equal(generated, false);
});

test("missing configuration, foreign origins and oversized requests never call the model", async () => {
  let called = false; const deps = defaults({ respond: async () => { called = true; return reply("Unexpected"); } });
  assert.equal((await handleDemoAssistant(request({ action: "summary" }), { ...env, GEMINI_API_KEY: "" }, deps)).status, 503);
  assert.equal((await handleDemoAssistant(request({ action: "summary" }, { Origin: "https://attacker.example" }), env, deps)).status, 403);
  assert.equal((await handleDemoAssistant(request({ action: "summary", state: "x".repeat(210000) }), env, deps)).status, 413);
  assert.equal(called, false);
});

test("recorded fallback is a separate fictional artifact with exact reconciled rows", async () => {
  const example = JSON.parse(readFileSync(new URL("../public/ai-demo-recorded-example.json", import.meta.url)));
  assert.equal(example.model, "gemini-3.5-flash"); assert.equal(example.sourceFile, "fictional-statement.pdf");
  assert.equal(example.previews.length, 3);
  const { statementChecks } = await import("../lib/ai-finance.ts");
  assert.ok(statementChecks(example.previews, example.statement).every(c => c.ok));
  assert.ok(readFileSync(new URL("../public/fictional-statement.pdf", import.meta.url)).subarray(0, 10).toString().includes("%PDF"));
});
