import { emptyWorkspace, type Entry, type Workspace } from "./ledger.ts";
import type { AssistantResult } from "./ai-contract.ts";

export const demoActions = {
  summary: { label: "Summarize the sample history", prompt: "Summarize the complete fictional sample ledger from its first recorded day, including each year, each currency, current balances and largest expenses. Keep currencies separate and cite calculated reports." },
  search: { label: "Find the largest sample expenses", prompt: "Find the largest expenses in the fictional sample ledger during September 2026. Explain the difference between gross expenses and personal spending using the calculated report." },
  statement: { label: "Read the sample bank PDF", prompt: "Start a fresh fictional review scenario and replace any earlier draft batch. Read the attached sample statement and prepare only its three transactions for review using the fictional BCA account. Preserve exact decimals, source quotes and stated totals. Opening/closing balances are not transactions. Do not save anything." },
  dinner: { label: "Split a fictional dinner expense", prompt: "Start a fresh fictional review scenario and replace any earlier draft batch. On 2026-11-01 I paid IDR 240,000 for a group dinner from BCA. Sam owes IDR 90,000 and Alex owes IDR 60,000, both due 2026-11-20. The remaining IDR 90,000 is my share. Prepare only one expense with separate reimbursement claims, not three expenses. Do not save it." },
  correction: { label: "Correct the dinner draft", prompt: "Correct the fictional dinner draft: the dinner cost IDR 270,000, Sam owes IDR 100,000, and Alex still owes IDR 60,000. Keep 2026-11-01, BCA and both due dates of 2026-11-20. Return one updated preview with separate claims. Do not save anything." },
} as const;
export type DemoAction = keyof typeof demoActions;
export type DemoResult = AssistantResult & { state: string; userText: string; sampleAttached: boolean };
export const SAMPLE_PDF_NAME = "finance-studio-fictional-statement.pdf";

// Independent of browser demo storage, signed-in users, and Supabase financial tables.
export function createAIDemo(): Workspace {
  const entry = (id: string, kind: Entry["kind"], amount_minor: number, extra: Partial<Entry> = {}): Entry => ({
    id, kind, amount_minor, account_id: "bank", occurred_on: "2026-09-01", description: id, notes: "Fictional portfolio sample",
    category_id: null, destination_account_id: null, custom_values: {}, reimbursable_minor: 0, counterparty: "", due_on: null, ...extra,
  });
  return { ...structuredClone(emptyWorkspace),
    accounts: [
      { id: "bank", name: "BCA (fictional)", currency: "IDR", kind: "bank", opening_minor: 100000000, opening_date: "2020-01-01", archived: false },
      { id: "usd", name: "USD savings (fictional)", currency: "USD", kind: "bank", opening_minor: 0, opening_date: "2020-01-01", archived: false },
    ],
    transactions: [
      entry("Earlier salary", "income", 200000000, { occurred_on: "2020-01-02" }),
      entry("Monthly salary", "income", 500000000),
      entry("Lunch", "expense", 4790050, { occurred_on: "2026-09-03" }),
      entry("Subscription", "expense", 14900000, { occurred_on: "2026-09-05" }),
      entry("USD project", "income", 12345, { account_id: "usd" }),
    ],
  };
}
