import { Buffer } from "node:buffer";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { configuredCloud, type CloudConfig } from "./ledger-cloud-config.ts";
import { chatMessageSchema, previewForModel, proposedEntrySchema, statementSchema, type AssistantResult } from "./ai-contract.ts";
import { createAIDemo, demoActions, SAMPLE_PDF_NAME, type DemoAction } from "./ai-demo.ts";
import sampleStatement from "./ai-demo-statement.json" with { type: "json" };
import { handleAssistant, respondWithGemini, type AIEnvironment, type AssistantDependencies } from "./ai-server.ts";

const actionSchema = z.enum(Object.keys(demoActions) as [DemoAction, ...DemoAction[]]);
const requestSchema = z.object({ action: actionSchema, state: z.string().max(180000).optional() }).strict();
const stateSchema = z.object({ version: z.literal(1), expires: z.number(), turns: z.number().int().min(0).max(8),
  messages: z.array(chatMessageSchema).max(16), previews: z.array(proposedEntrySchema).max(150), statement: statementSchema.nullable() }).strict();
type DemoState = z.infer<typeof stateSchema>;
export type DemoDependencies = {
  reserve: (visitorHash: string, cloud: CloudConfig) => Promise<boolean>;
  respond: AssistantDependencies["respond"];
  now?: () => number;
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
class DemoError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
const defaults: DemoDependencies = {
  async reserve(visitorHash, cloud) {
    const client = createClient(cloud.url, cloud.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    // An anonymous counter RPC is the only database operation; no user JWT or financial table is used.
    const { data, error } = await client.rpc("ledger_ai_demo_reserve", { p_visitor_hash: visitorHash });
    if (error) throw new DemoError("The AI demo is waiting for its request-limit setup. Try again later.", 503);
    return data === true;
  }, respond: respondWithGemini,
};
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signState(state: DemoState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode("demo-state:" + payload));
  return payload + "." + Buffer.from(signature).toString("base64url");
}
async function verifyState(token: string, secret: string, now: number): Promise<DemoState> {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !await crypto.subtle.verify("HMAC", await hmacKey(secret), Buffer.from(signature, "base64url"), new TextEncoder().encode("demo-state:" + payload))) throw Error();
    const state = stateSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (state.expires < now) throw Error();
    return state;
  } catch { throw new DemoError("This demo conversation expired or could not be verified. Start a new demo chat.", 400); }
}
async function readRequest(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new DemoError("Choose a demo scenario.", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 200000) { await reader.cancel(); throw new DemoError("This demo request is too large. Start a new chat.", 413); }
    chunks.push(value);
  }
  try { return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { throw new DemoError("Choose a built-in fictional scenario. Custom messages, uploads and ledger records are not accepted by this demo.", 400); }
}
export async function handleDemoAssistant(request: Request, env: AIEnvironment = {}, dependencies: DemoDependencies = defaults) {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new DemoError("Open the demo from Finance Studio.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DemoError("Use a JSON request.", 415);
    const body = await readRequest(request);
    const key = (env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY)?.trim(); const cloud = configuredCloud(env);
    if (!key || !cloud) throw new DemoError("The AI demo is not configured yet. Try again later.", 503);
    const now = dependencies.now?.() ?? Date.now();
    const state: DemoState = body.state ? await verifyState(body.state, key, now)
      : { version: 1, expires: now + 3600000, turns: 0, messages: [], previews: [], statement: null };
    if (state.turns >= 8) throw new DemoError("This demo chat is full. Start a new chat to try more scenarios.", 422);
    // Each scenario is self-contained; only the correction step continues the preceding AI exchange.
    if (body.action !== "correction") state.messages = [];
    if (body.action === "statement" || body.action === "dinner") { state.previews = []; state.statement = null; }
    const user = { role: "user" as const, text: demoActions[body.action].prompt,
      ...(body.action === "statement" ? { attachments: [{ name: SAMPLE_PDF_NAME, type: "application/pdf" as const, data: sampleStatement.data }] } : {}) };
    // Trust only platform-controlled IP headers; without one, all requests share a conservative bucket.
    const ip = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? "shared-local-visitor";
    const digest = await crypto.subtle.sign("HMAC", await hmacKey(key), new TextEncoder().encode("demo-visitor:" + ip.slice(0, 200)));
    if (!await dependencies.reserve(Buffer.from(digest).toString("hex"), cloud)) return json({ error: "The public demo’s request limit has been reached. Wait a moment or try again tomorrow. Shared API quota is limited." }, 429);
    const messages = [...state.messages, user];
    const engineRequest = new Request(request.url, { method: "POST", signal: request.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer demo.internal" },
      body: JSON.stringify({ messages, sheet_id: "", currency: "IDR", previews: state.previews, statement: state.statement }) });
    const response = await handleAssistant(engineRequest, { ...env, SUPABASE_URL: "https://demo.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo" }, {
      demo: true, authenticate: async () => ({ userId: "fictional-portfolio-demo", workspace: createAIDemo() }), respond: dependencies.respond,
    });
    const result = await response.json() as AssistantResult & { error?: string };
    if (!response.ok) return json({ error: result.error ?? "The AI demo could not respond. Try again." }, response.status);
    const next: DemoState = { ...state, turns: state.turns + 1, messages: [...messages, { role: "assistant", text: result.text }],
      previews: result.previews === null ? state.previews : result.previews.map(previewForModel), statement: result.previews === null ? state.statement : result.statement };
    return json({ ...result, state: await signState(next, key), userText: user.text, sampleAttached: body.action === "statement" });
  } catch (error) {
    if (error instanceof DemoError) return json({ error: error.message }, error.status);
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return json({ error: "The demo request was cancelled or timed out. No records were saved." }, 504);
    return json({ error: "The AI demo could not complete this request. Try again later." }, 500);
  }
}
