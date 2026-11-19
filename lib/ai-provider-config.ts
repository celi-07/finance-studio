import { z } from "zod";

export const aiProviders = {
  gemini: { label: "Google Gemini", model: "gemini-3.5-flash", keyUrl: "https://aistudio.google.com/api-keys", prefix: "gemini-" },
  openai: { label: "OpenAI GPT", model: "gpt-5.4", keyUrl: "https://platform.openai.com/api-keys", prefix: "gpt-" },
  anthropic: { label: "Anthropic Claude", model: "claude-sonnet-5-5", keyUrl: "https://platform.claude.com/settings/keys", prefix: "claude-" },
} as const;
export type AIProvider = keyof typeof aiProviders;

export const personalAIConfigSchema = z.object({
  provider: z.enum(["gemini", "openai", "anthropic"]),
  apiKey: z.string().trim().min(20, "Enter your provider’s API key.").max(512).regex(/^[\x21-\x7e]*$/, "The API key must not contain spaces or line breaks."),
  model: z.string().trim().min(1, "Enter a model ID.").max(100).regex(/^[a-zA-Z0-9._-]+$/, "Use a model ID, such as gemini-3.5-flash."),
}).strict().refine(config => config.model.startsWith(aiProviders[config.provider].prefix), {
  message: "Choose a model ID belonging to the selected provider.", path: ["model"],
});
export type PersonalAIConfig = z.infer<typeof personalAIConfigSchema>;
