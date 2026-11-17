import { emptyWorkspace } from "../../lib/ledger.ts";

const account = (id, kind, opening_minor, opening_date = "2026-09-01", extra = {}) => ({ id, name: `QA ${id}`, kind, currency: "IDR", opening_minor, opening_date, archived: false, ...extra });
const entry = (id, kind, amount_minor, occurred_on, extra = {}) => ({ id, description: `QA ${id}`, kind, amount_minor, occurred_on, account_id: "bank", category_id: null, destination_account_id: null, notes: "", reimbursable_minor: 0, counterparty: "", due_on: null, custom_values: {}, ...extra });

export function statementWorkspace() {
  return { ...structuredClone(emptyWorkspace),
    finance_books: [{ id: "business", name: "QA Business" }],
    accounts: [account("bank", "bank", 100000), account("wallet", "wallet", 25000, "2026-10-03"),
      account("cash", "cash", 5000, "2026-09-01", { archived: true }), account("investment", "investment", 20000),
      account("future", "bank", 50000, "2026-11-01"), account("usd", "bank", 9876, "2026-09-01", { currency: "USD" }),
      account("business-bank", "bank", 900000, "2026-09-01", { ledger_id: "business" })],
    transactions: [entry("salary", "income", 50000, "2026-10-02"),
      entry("lunch", "expense", 12000, "2026-10-04", { reimbursable_minor: 4000, counterparty: "QA Sam" }),
      entry("transfer", "transfer", 10000, "2026-10-05", { destination_account_id: "wallet" }),
      entry("contribution", "investment_contribution", 8000, "2026-10-06", { destination_account_id: "investment" }),
      entry("withdrawal", "investment_withdrawal", 3000, "2026-10-07", { account_id: "investment", destination_account_id: "bank" }),
      entry("linked-income", "income", 2000, "2026-10-08"),
      entry("historic-wallet", "income", 777000, "2026-10-01", { account_id: "wallet" })],
    reimbursement_receipts: [{ id: "receipt", expense_id: "lunch", income_entry_id: "linked-income", account_id: "bank", amount_minor: 2000, received_on: "2026-10-08", notes: "" }],
    balance_updates: [{ id: "bank-check", account_id: "bank", recorded_on: "2026-10-31", frequency: "monthly", balance_minor: 130000 }],
    investment_valuations: [{ id: "valuation", investment_account_id: "investment", valued_on: "2026-10-31", value_minor: 31000 }],
  };
}
