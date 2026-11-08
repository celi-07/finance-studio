import assert from "node:assert/strict";
import { test } from "node:test";
import { balances, claims, emptyWorkspace, money, monthly, parseDate, parseMoney, validateEntry } from "../lib/ledger.ts";
import { readCloudConfig } from "../lib/ledger-cloud-config.ts";

const month = "2025-02";
const account = (id, kind, opening_minor = 0) => ({ id, name: id, kind, opening_minor, opening_date: "2025-01-01", archived: false });
const entry = (id, kind, amount_minor, options = {}) => ({
  id, kind, amount_minor, account_id: "bank", occurred_on: "2025-02-03", description: id, notes: "",
  category_id: null, destination_account_id: null, custom_values: {}, reimbursable_minor: 0,
  counterparty: "", due_on: null, ...options,
});
const setup = () => ({ ...emptyWorkspace, accounts: [account("bank", "bank", 100_000), account("wallet", "wallet"), account("fund", "investment")] });

test("only browser-safe Supabase settings reach the client", () => {
  const url = "https://ledger.example";
  const legacyKey = role => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.equal(readCloudConfig(), null);
  assert.deepEqual(readCloudConfig(url, "sb_publishable_example"), { url, key: "sb_publishable_example" });
  assert.equal(readCloudConfig(url, legacyKey("anon")).key, legacyKey("anon"));
  assert.throws(() => readCloudConfig(url, legacyKey("service_role")));
  assert.throws(() => readCloudConfig(url, "sb_secret_example"));
  assert.throws(() => readCloudConfig(url));
  assert.throws(() => readCloudConfig("https://user:password@ledger.example", "sb_publishable_example"));
});

test("parses rupiah minor units and Jakarta calendar dates without floating-point rounding", () => {
  assert.equal(parseMoney("Rp 125.000,50"), 12_500_050);
  assert.equal(parseMoney("1,25"), 125);
  assert.equal(parseMoney("90071992547409,91"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseMoney("90071992547409,92"), null);
  assert.equal(money(Number.MAX_SAFE_INTEGER), "Rp\u00a090.071.992.547.409,91");
  assert.equal(parseDate("29/02/2024"), "2024-02-29");
  assert.equal(parseDate("29/02/2025"), null);
});

test("accounts include openings and transfers while monthly income and spending exclude both", () => {
  const workspace = setup();
  workspace.transactions = [
    entry("pay", "income", 50_000),
    entry("groceries", "expense", 10_000),
    entry("top-up", "transfer", 20_000, { destination_account_id: "wallet" }),
    entry("next-month", "income", 1_000, { occurred_on: "2025-03-01" }),
  ];
  const report = monthly(workspace, month);
  assert.equal(report.cash, 140_000);
  assert.equal(report.income, 50_000);
  assert.equal(report.spending, 10_000);
  assert.equal(report.accounts.find(row => row.account.id === "wallet").value, 20_000);
  assert.equal(monthly(workspace, "2025-03").income, 1_000);
});

test("partial reimbursement changes cash and outstanding claims without double counting spending", () => {
  const workspace = setup();
  workspace.transactions = [entry("lunch", "expense", 12_000, { reimbursable_minor: 7_000, counterparty: "Group" })];
  workspace.reimbursement_receipts = [{ id: "p", expense_id: "lunch", account_id: "bank", received_on: "2025-02-04", amount_minor: 3_000 }];
  const report = monthly(workspace, month);
  assert.equal(report.income, 0);
  assert.equal(report.gross, 12_000);
  assert.equal(report.spending, 5_000);
  assert.equal(report.collected, 3_000);
  assert.equal(report.receivable, 4_000);
  assert.equal(report.cash, 91_000);
  assert.equal(claims(workspace)[0].status, "Partial");
});

test("investment value combines the last valuation and later movements once", () => {
  const workspace = setup();
  workspace.transactions = [
    entry("start", "investment_contribution", 20_000, { destination_account_id: "fund" }),
    entry("add", "investment_contribution", 5_000, { destination_account_id: "fund", occurred_on: "2025-02-06" }),
  ];
  workspace.investment_valuations = [{ id: "v", investment_account_id: "fund", valued_on: "2025-02-03", value_minor: 21_000 }];
  const report = monthly(workspace, month);
  assert.equal(balances(workspace, "2025-02-04").find(row => row.account.id === "fund").value, 21_000);
  assert.equal(report.cash, 75_000);
  assert.equal(report.income, 0);
  assert.equal(report.invested, 26_000);
  assert.equal(report.totalAssets, 101_000);
});

test("editing keeps archived field values and validates account opening date and existing payments", () => {
  const workspace = setup();
  workspace.transactions = [entry("lunch", "expense", 12_000, { reimbursable_minor: 7_000, counterparty: "Group", custom_values: { old: "saved" } })];
  workspace.reimbursement_receipts = [{ id: "p", expense_id: "lunch", account_id: "bank", received_on: "2025-02-04", amount_minor: 3_000 }];
  workspace.field_definitions = [{ id: "old", label: "Previous label", field_type: "text", options: [], required: false, position: 0, archived: true }];
  const draft = { ...workspace.transactions[0], amount: "120", reimbursable: "70", custom: {} };
  assert.deepEqual(validateEntry(workspace, draft).entry.custom_values, { old: "saved" });
  assert.match(validateEntry(workspace, { ...draft, reimbursable: "20" }).errors.reimbursable, /payments/);
  assert.match(validateEntry(workspace, { ...draft, occurred_on: "2024-12-01" }).errors.account_id, /open/);
});
