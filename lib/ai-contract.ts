import { z } from "zod";
import { currencies, kinds, type Currency, type EntryDraft } from "./ledger.ts";
import { personalAIConfigSchema } from "./ai-provider-config.ts";

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_PREVIEWS = 150;
export const currencySchema = z.enum(Object.keys(currencies) as [Currency, ...Currency[]]);
export const attachmentSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]),
  data: z.string().max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4),
});
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]), text: z.string().max(24000),
  attachments: z.array(attachmentSchema).max(5).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export const proposedEntrySchema = z.object({
  kind: z.enum(Object.keys(kinds) as [keyof typeof kinds, ...(keyof typeof kinds)[]]),
  occurred_on: z.string().max(10).nullable(), description: z.string().max(240),
  amount: z.string().max(40), currency: currencySchema,
  account_id: z.string().max(80).nullable(), destination_account_id: z.string().max(80).nullable(),
  category_id: z.string().max(80).nullable(), notes: z.string().max(2000).default(""),
  reimbursable: z.string().max(40).default(""), counterparty: z.string().max(200).default(""),
  due_on: z.string().max(10).nullable().default(null),
  people: z.array(z.object({ counterparty: z.string().max(160), amount: z.string().max(40), due_on: z.string().max(10).nullable() })).max(30).default([]),
  custom: z.record(z.string().max(80), z.union([z.string().max(1000), z.boolean()])).default({}),
  source: z.object({ filename: z.string().max(160), page: z.number().int().min(1).nullable(), quote: z.string().max(300) }).nullable(),
  warnings: z.array(z.string().max(500)).max(12),
});
export const statementSchema = z.object({
  filename: z.string().max(160), currency: currencySchema,
  opening_balance: z.string().max(40).nullable(), closing_balance: z.string().max(40).nullable(),
  total_debits: z.string().max(40).nullable(), total_credits: z.string().max(40).nullable(),
  transaction_count: z.number().int().min(0).nullable(),
});
export const previewToolSchema = z.object({
  entries: z.array(proposedEntrySchema).min(1).max(MAX_PREVIEWS),
  statement: statementSchema.nullable(),
});
export type ProposedEntry = z.infer<typeof proposedEntrySchema>;
export type Statement = z.infer<typeof statementSchema>;
export type DraftPreview = {
  draft: EntryDraft; currency: Currency; source: ProposedEntry["source"];
  warnings: string[]; errors: Record<string, string>; duplicates: string[];
};
export type ReportEvidence = { id: string; title: string; data: Record<string, unknown> };
export const reportDownloadSchema = z.object({
  kind: z.enum(["overview", "transactions", "reimbursements", "investments"]),
  period: z.string().regex(/^(all|(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?)$/),
  currency: currencySchema, scope: z.enum(["sheet", "all"]), sheet_id: z.string().max(80).nullable(),
}).strict();
export type ReportDownload = z.infer<typeof reportDownloadSchema>;
export type AssistantResult = { text: string; previews: DraftPreview[] | null; statement: Statement | null; evidence: ReportEvidence[];
  downloads?: ReportDownload[]; changes?: import("./ai-workspace.ts").WorkspacePreview[] };
export const assistantRequestSchema = z.object({
  personalAI: personalAIConfigSchema.optional(),
  messages: z.array(chatMessageSchema).min(1).max(30),
  sheet_id: z.string().max(80), currency: currencySchema,
  previews: z.array(proposedEntrySchema).max(MAX_PREVIEWS).default([]),
  statement: statementSchema.nullable().default(null),
});

export function previewForModel(preview: DraftPreview): ProposedEntry {
  const { draft, currency, source, warnings } = preview;
  return { kind: draft.kind as ProposedEntry["kind"], occurred_on: draft.occurred_on || null,
    description: draft.description, amount: draft.amount, currency, account_id: draft.account_id || null,
    destination_account_id: draft.destination_account_id, category_id: draft.category_id, notes: draft.notes,
    reimbursable: draft.reimbursable, counterparty: draft.counterparty, due_on: draft.due_on,
    people: (draft.people ?? []).map(({ counterparty, amount, due_on }) => ({ counterparty, amount, due_on })), custom: draft.custom, source, warnings };
}
