import { z } from "zod";
import type { GeminiContent, GeminiPart, GeminiResponse } from "./ai-server.ts";
import { AssistantError, ProviderBusyError } from "./ai-errors.ts";
import { aiProviders, type AIProvider } from "./ai-provider-config.ts";

const requestSchema = z.object({
  model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  systemInstruction: z.object({ parts: z.array(z.object({ text: z.string() })) }),
  contents: z.array(z.custom<GeminiContent>()),
  tools: z.array(z.object({ functionDeclarations: z.array(z.object({ name: z.string(), description: z.string(), parametersJsonSchema: z.record(z.string(), z.unknown()) })) })),
});

export async function respondWithGemini(body: Record<string, unknown>, key: string, signal: AbortSignal): Promise<GeminiResponse> {
  const { model, ...payload } = body;
  if (typeof model !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new AssistantError("The Gemini model configuration is invalid. Contact the site owner.", 503);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", redirect: "error", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { status?: string } } | null;
    if (response.status === 429) throw new AssistantError("Gemini API quota is exhausted. Try later or ask the site owner to check the project’s quota and billing.", 429);
    if (response.status === 503) throw new ProviderBusyError("Gemini is temporarily busy. Try again shortly. No entries were saved.", 503);
    if ([401, 403, 404].includes(response.status) || failure?.error?.status === "FAILED_PRECONDITION") throw new AssistantError("The Gemini API key, model or project needs attention. Contact the site owner.", 503);
    throw new AssistantError("The AI service could not complete this request. Try again or contact the site owner.", 502);
  }
  return response.json();
}

function personalError(provider: AIProvider, status: number): never {
  const name = aiProviders[provider].label;
  if ([401, 403].includes(status)) throw new AssistantError(`${name} rejected your personal API key or its permissions. Check AI settings. No entries were saved.`, 422);
  if (status === 429) throw new AssistantError(`${name} has reached your API quota or rate limit. Check your provider’s billing or try again later. No entries were saved.`, 429);
  if ([400, 404, 413, 422].includes(status)) throw new AssistantError(`${name} could not use this model or attachment. Check the model ID and access in AI settings, or try a smaller file. No entries were saved.`, 422);
  throw new AssistantError(`${name} is temporarily unavailable. Try again shortly. No entries were saved.`, 502);
}

const openAIResponseSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.string().nullable(),
  message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional(),
    tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
  }),
})) });
const claudeBlockSchema = z.object({ type: z.string(), text: z.string().optional(), id: z.string().optional(), name: z.string().optional(), input: z.record(z.string(), z.unknown()).optional() });
const claudeResponseSchema = z.object({ stop_reason: z.string().nullable(), content: z.array(claudeBlockSchema) });

function normalize(parts: GeminiPart[], complete: boolean): GeminiResponse {
  return { candidates: [{ finishReason: complete ? "STOP" : "MAX_TOKENS", content: { role: "model", parts } }] };
}

export async function respondWithProvider(body: Record<string, unknown>, key: string, signal: AbortSignal, provider: AIProvider = "gemini"): Promise<GeminiResponse> {
  if (provider === "gemini") return respondWithGemini(body, key, signal);
  const input = requestSchema.parse(body);
  const system = input.systemInstruction.parts.map(part => part.text).join("\n");
  const declarations = input.tools.flatMap(group => group.functionDeclarations);
  if (provider === "openai") {
    const messages: Record<string, unknown>[] = [{ role: "system", content: system }];
    for (const turn of input.contents) {
      const results = turn.parts.flatMap(part => part.functionResponse ? [part.functionResponse] : []);
      for (const result of results) messages.push({ role: "tool", tool_call_id: result.id, content: JSON.stringify(result.response) });
      const content = turn.parts.flatMap((part): Record<string, unknown>[] => {
        if (part.text !== undefined && !part.thought) return [{ type: "text", text: part.text }];
        if (part.inlineData?.mimeType === "application/pdf") return [{ type: "file", file: { filename: "statement.pdf", file_data: `data:application/pdf;base64,${part.inlineData.data}` } }];
        if (part.inlineData) return [{ type: "image_url", image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }];
        return [];
      });
      const calls = turn.parts.flatMap(part => part.functionCall ? [{ id: part.functionCall.id, type: "function", function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } }] : []);
      if (turn.role === "model") messages.push({ role: "assistant", content: content.length ? content.map(part => part.text ?? "").join("\n") : null, ...(calls.length ? { tool_calls: calls } : {}) });
      else if (content.length) messages.push({ role: "user", content });
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages, store: false, max_completion_tokens: 32768,
        tools: declarations.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parametersJsonSchema, strict: false } })),
      }),
    });
    if (!response.ok) personalError(provider, response.status);
    const result = openAIResponseSchema.parse(await response.json()).choices[0];
    if (!result || result.message.refusal) throw new AssistantError("The AI could not safely interpret this request. Try a clearer message. No entries were saved.", 422);
    const parts: GeminiPart[] = result.message.content ? [{ text: result.message.content }] : [];
    for (const call of result.message.tool_calls ?? []) {
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new AssistantError("The AI returned invalid tool arguments. Try a clearer request. No entries were saved.", 422); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new AssistantError("The AI returned invalid tool arguments. Try again. No entries were saved.", 422);
      parts.push({ functionCall: { id: call.id, name: call.function.name, args: args as Record<string, unknown> } });
    }
    return normalize(parts, ["stop", "tool_calls"].includes(result.finish_reason ?? ""));
  }
  const messages = input.contents.map(turn => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.parts.flatMap((part): Record<string, unknown>[] => {
    if (part.text !== undefined && !part.thought) return [{ type: "text", text: part.text }];
    if (part.inlineData) return [{ type: part.inlineData.mimeType === "application/pdf" ? "document" : "image", source: { type: "base64", media_type: part.inlineData.mimeType, data: part.inlineData.data } }];
    if (part.functionCall) return [{ type: "tool_use", id: part.functionCall.id, name: part.functionCall.name, input: part.functionCall.args ?? {} }];
    if (part.functionResponse) return [{ type: "tool_result", tool_use_id: part.functionResponse.id, content: JSON.stringify(part.functionResponse.response) }];
    return [];
  }) }));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", redirect: "error", signal,
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, system, messages, max_tokens: 16384, thinking: { type: "disabled" },
      tools: declarations.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parametersJsonSchema })),
    }),
  });
  if (!response.ok) personalError(provider, response.status);
  const result = claudeResponseSchema.parse(await response.json());
  const parts = result.content.flatMap((block): GeminiPart[] => {
    if (block.type === "text" && block.text) return [{ text: block.text }];
    if (block.type === "tool_use" && block.id && block.name) return [{ functionCall: { id: block.id, name: block.name, args: block.input ?? {} } }];
    return [];
  });
  return normalize(parts, ["end_turn", "tool_use"].includes(result.stop_reason ?? ""));
}
