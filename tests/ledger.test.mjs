import assert from "node:assert/strict";
import { test } from "node:test";
import { activity, balances, cashLedger, claims, draftFrom, emptyWorkspace, formatMoneyInput, groupNumber, historicalAccounts, money, monthly, overviewHistory, parseDate, parseMoney, periodReport, reimbursementReport, validateEntry, validateFormEntry, workspaceForBook } from "../lib/ledger.ts";
import { readCloudConfig } from "../lib/ledger-cloud-config.ts";
import { quickEntry, reviseQuickEntry } from "../lib/quick-entry.ts";

const month = "2025-02";
const account = (id, kind, opening_minor = 0) => ({ id, name: id, kind, opening_minor, opening_date: "2025-01-01", archived: false });
const entry = (id, kind, amount_minor, options = {}) => ({
  id, kind, amount_minor, account_id: "bank", occurred_on: "2025-02-03", description: id, notes: "",
  category_id: null, destination_account_id: null, custom_values: {}, reimbursable_minor: 0,
  counterparty: "", due_on: null, ...options,
});
const setup = () => ({ ...emptyWorkspace, accounts: [account("bank", "bank", 100_000), account("wallet", "wallet"), account("fund", "investment")] });

test("splitting a legacy claim keeps its payment and enforces each person's outstanding amount", () => {
  const workspace = setup();
  const expense = entry("lunch", "expense", 12000, { reimbursable_minor: 7000, counterparty: "Sam" });
  workspace.transactions = [expense];
  workspace.reimbursement_receipts = [{ id: "paid", expense_id: expense.id, account_id: "bank", received_on: "2025-02-04", amount_minor: 3000 }];
  const draft = { ...draftFrom(expense), people: [
    { id: expense.id, counterparty: "Sam", amount: "40.00", due_on: null },
    { id: "second", counterparty: "Alex", amount: "30.00", due_on: "2025-02-08" },
  ] };
  const result = validateFormEntry(workspace, draft, "split");
  assert.ok(result.entry);
  workspace.transactions = [result.entry];
  assert.deepEqual(claims(workspace).map(claim => [claim.counterparty, claim.remaining, claim.due_on]), [
    ["Sam", 1000, null], ["Alex", 3000, "2025-02-08"],
  ]);
  assert.equal(monthly(workspace, month).spending, 5000);
  assert.ok(validateFormEntry(workspace, { ...draft, people: [draft.people[1]] }, "split").errors.reimbursable);
  const oversized = { ...draft, people: [draft.people[0], { ...draft.people[1], amount: "85.00" }] };
  assert.ok(validateFormEntry(workspace, oversized, "split").errors.reimbursable);
});

test("linking and unlinking an existing deposit leaves cash intact and moves it between income and reimbursements", () => {
  const workspace = setup();
  const expense = entry("lunch", "expense", 12000, { reimbursable_minor: 7000, counterparty: "Sam" });
  const income = entry("deposit", "income", 5000, { occurred_on: "2025-02-04" });
  workspace.transactions = [expense, income];
  workspace.reimbursement_receipts = [{
    id: "payment", expense_id: expense.id, claim_id: expense.id, income_entry_id: income.id,
    account_id: income.account_id, received_on: income.occurred_on, amount_minor: income.amount_minor,
  }];
  const linked = monthly(workspace, month);
  assert.deepEqual([linked.cash, linked.income, linked.collected, linked.receivable], [93000, 0, 5000, 2000]);
  assert.deepEqual(activity(workspace, month).map(row => row.id), ["payment", "lunch"]);
  workspace.reimbursement_receipts = [];
  const unlinked = monthly(workspace, month);
  assert.deepEqual([unlinked.cash, unlinked.income, unlinked.collected, unlinked.receivable], [93000, 5000, 0, 7000]);
});

test("reimbursement filters scope split claims, payments, and period totals to the selected people", () => {
  const workspace = setup();
  workspace.transactions = [
    entry("group-meal", "expense", 15000, {
      reimbursable_minor: 11000, counterparty: "Multiple people", reimbursement_claims: [
        { id: "sam", amount_minor: 6000, counterparty: "Sam", due_on: null },
        { id: "alex", amount_minor: 5000, counterparty: "Alex", due_on: null },
      ],
    }),
    entry("older", "expense", 9000, { occurred_on: "2025-01-20", reimbursable_minor: 8000, counterparty: "Jo" }),
    entry("settled-earlier", "expense", 1000, { occurred_on: "2025-01-10", reimbursable_minor: 1000, counterparty: "Taylor" }),
    entry("settled-this-month", "expense", 3000, { occurred_on: "2025-01-25", reimbursable_minor: 3000, counterparty: "Nia" }),
  ];
  const receipt = (id, expense_id, received_on, amount_minor, claim_id) => ({ id, expense_id, account_id: "bank", received_on, amount_minor, claim_id });
  workspace.reimbursement_receipts = [
    receipt("sam-payment", "group-meal", "2025-02-10", 2000, "sam"),
    receipt("alex-payment", "group-meal", "2025-02-12", 3000, "alex"),
    receipt("jo-payment", "older", "2025-01-21", 1000),
    receipt("taylor-payment", "settled-earlier", "2025-01-15", 1000),
    receipt("nia-payment", "settled-this-month", "2025-02-14", 3000),
  ];
  const check = (selected, names, paymentIds, totals) => {
    const report = reimbursementReport(workspace, month, selected);
    assert.deepEqual(report.people, ["Alex", "Jo", "Nia", "Sam"]);
    assert.deepEqual(report.claims.map(claim => claim.counterparty), names);
    assert.deepEqual(report.receipts.map(row => row.id), paymentIds);
    assert.deepEqual([report.opening, report.newClaims, report.collected, report.outstanding], totals);
  };
  check(["Sam"], ["Sam"], ["sam-payment"], [0, 6000, 2000, 4000]);
  check(["Sam", "Jo"], ["Sam", "Jo"], ["sam-payment"], [7000, 6000, 2000, 11000]);
  check([], ["Sam", "Alex", "Jo", "Nia"], ["sam-payment", "alex-payment", "nia-payment"], [10000, 11000, 8000, 13000]);
  check(["Taylor"], [], [], [0, 0, 0, 0]);
});

test("a reimbursement received before account tracking settles the claim without changing tracked cash", () => {
  const workspace = setup();
  workspace.accounts[0].opening_date = "2025-02-15";
  workspace.transactions = [entry("historical-claim", "expense", 8000, { reimbursable_minor: 5000, counterparty: "Sam" })];
  workspace.reimbursement_receipts = [{
    id: "historical-payment", expense_id: "historical-claim", account_id: "bank", received_on: "2025-02-10", amount_minor: 5000,
  }];
  const report = monthly(workspace, month);
  assert.equal(report.cash, 100_000);
  assert.equal(report.collected, 5000);
  assert.equal(report.receivable, 0);
  assert.equal(claims(workspace)[0].status, "Settled");
});

test("a combined payment settles several claims and appears as one cash movement", () => {
  const workspace = setup();
  workspace.transactions = [
    entry("lunch", "expense", 4000, { reimbursable_minor: 3000, counterparty: "Sam" }),
    entry("tickets", "expense", 5000, { reimbursable_minor: 2000, counterparty: "Alex" }),
  ];
  workspace.reimbursement_receipts = workspace.transactions.map((expense, index) => ({
    id: index ? "second" : "deposit", expense_id: expense.id, payment_group_id: "deposit", account_id: "bank",
    received_on: "2025-02-10", amount_minor: expense.reimbursable_minor,
  }));
  assert.deepEqual(claims(workspace).map(claim => claim.status), ["Settled", "Settled"]);
  assert.deepEqual(activity(workspace, month).filter(row => row.receipt).map(row => [row.id, row.amount]), [["deposit", 5000]]);
  assert.equal(cashLedger(workspace, month, "IDR").inflow, 5000);
  assert.equal(reimbursementReport(workspace, month, ["Alex"]).collected, 2000);
});

test("Overview trends use monthly income, gross expenses, and wealth in one currency", () => {
  const workspace = setup();
  workspace.accounts.push({ ...account("usd", "bank", 90_000), currency: "USD" });
  workspace.transactions = [
    entry("income", "income", 10_000, { occurred_on: "2025-01-10" }),
    entry("expense", "expense", 5_000, { reimbursable_minor: 2_000, counterparty: "Sam" }),
    entry("usd-income", "income", 30_000, { account_id: "usd" }),
  ];
  workspace.reimbursement_receipts = [{ id: "payment", expense_id: "expense", account_id: "bank", received_on: "2025-02-11", amount_minor: 1_000 }];
  assert.deepEqual(overviewHistory(workspace, "2025", "IDR", "2025-02"), [
    { month: "2025-01", wealth: 110_000, income: 10_000, expenses: 0 },
    { month: "2025-02", wealth: 107_000, income: 0, expenses: 5_000 },
  ]);
  assert.equal(overviewHistory(workspace, "all", "USD", "2025-02").at(-1).wealth, 120_000);
});

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

test("preserves whole, two-decimal, and three-decimal currencies without floating-point rounding", () => {
  assert.equal(parseMoney("USD 1,234.56", "USD"), 123456);
  assert.equal(parseMoney("USD 1,234.567", "USD"), null);
  assert.equal(parseMoney("EUR 9.50", "USD"), null);
  assert.equal(parseMoney("JPY 1,200", "JPY"), 1200);
  assert.equal(parseMoney("1200.50", "JPY"), null);
  assert.equal(parseMoney("1.003", "KWD"), 1003);
  assert.equal(money(1003, "KWD"), "KWD\u00a01.003");
  assert.equal(parseMoney("90071992547409.91", "USD"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseMoney("90071992547409.92", "USD"), null);
});

test("keeps reports, payments, investment values and transaction edits in the selected currency", () => {
  const workspace = setup();
  workspace.accounts.push({ ...account("usd", "bank", 12_500), currency: "USD" });
  workspace.accounts.push({ ...account("usd-fund", "investment"), currency: "USD" });
  const claim = entry("usd-expense", "expense", 1400, { account_id: "usd", reimbursable_minor: 1000, counterparty: "Group" });
  workspace.transactions = [entry("idr-income", "income", 99_000), claim];
  workspace.reimbursement_receipts = [{ id: "usd-payment", expense_id: claim.id, account_id: "usd", received_on: "2025-02-07", amount_minor: 600 }];
  workspace.investment_valuations = [{ id: "usd-valuation", investment_account_id: "usd-fund", valued_on: "2025-02-10", value_minor: 4_050 }];
  const usd = monthly(workspace, month, "USD");
  assert.deepEqual([usd.cash, usd.income, usd.spending, usd.collected, usd.receivable, usd.invested], [11700, 0, 400, 600, 400, 4050]);
  assert.equal(monthly(workspace, month).income, 99_000);
  assert.deepEqual(activity(workspace, month, "USD").map(row => row.id), ["usd-payment", claim.id]);
  const draft = draftFrom(claim, "USD");
  assert.equal(draft.amount, "14.00");
  assert.equal(validateEntry(workspace, draft).entry.amount_minor, 1400);
  assert.equal(validateEntry(workspace, { ...draft, account_id: "bank" }).errors.account_id, "Keep the entry in its original currency.");
  assert.equal(validateEntry(workspace, { ...draft, id: "transfer", kind: "transfer", destination_account_id: "wallet" }).errors.destination_account_id, "Choose a destination in the same currency.");
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

test("separates finance sheets while combining only like currencies", () => {
  const workspace = setup();
  workspace.finance_books = [{ id: "business", name: "Business" }];
  workspace.accounts.push(
    { ...account("business-bank", "bank"), ledger_id: "business" },
    { ...account("business-usd", "bank"), ledger_id: "business", currency: "USD" },
  );
  workspace.transactions = [
    entry("personal-income", "income", 25_000),
    entry("business-income", "income", 70_000, { account_id: "business-bank" }),
    entry("business-usd-income", "income", 50_000, { account_id: "business-usd" }),
  ];
  const personal = workspaceForBook(workspace, "");
  const business = workspaceForBook(workspace, "business");
  assert.deepEqual(personal.transactions.map(row => row.id), ["personal-income"]);
  assert.deepEqual(business.accounts.map(row => row.id), ["business-bank", "business-usd"]);
  assert.equal(monthly(business, month).income, 70_000);
  assert.equal(monthly(workspace, month).income, 95_000);
  assert.equal(monthly(workspace, month, "USD").income, 50_000);
  const personalIncome = draftFrom(workspace.transactions[0], "IDR");
  assert.equal(validateEntry(workspace, { ...personalIncome, account_id: "business-bank" }).errors.account_id,
    "Keep the entry in its original sheet.");
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

test("editing keeps archived field values and preserves existing payments", () => {
  const workspace = setup();
  workspace.transactions = [entry("lunch", "expense", 12_000, { reimbursable_minor: 7_000, counterparty: "Group", custom_values: { old: "saved" } })];
  workspace.reimbursement_receipts = [{ id: "p", expense_id: "lunch", account_id: "bank", received_on: "2025-02-04", amount_minor: 3_000 }];
  workspace.field_definitions = [{ id: "old", label: "Previous label", field_type: "text", options: [], required: false, position: 0, archived: true }];
  const draft = { ...workspace.transactions[0], amount: "120", reimbursable: "70", custom: {} };
  assert.deepEqual(validateEntry(workspace, draft).entry.custom_values, { old: "saved" });
  assert.match(validateEntry(workspace, { ...draft, reimbursable: "20" }).errors.reimbursable, /payments/);
  assert.match(validateEntry(workspace, { ...draft, occurred_on: "2025-02-05" }).errors.occurred_on, /linked payment/);
});

test("historical entries remain in reports while tracked balances start at each account's tracking date", () => {
  const workspace = setup();
  workspace.accounts[0].opening_date = "2025-02-10";
  const early = entry("historical", "expense", 12_000);
  const transfer = entry("between-openings", "transfer", 5_000, { destination_account_id: "wallet" });
  workspace.transactions = [early, transfer, entry("tracked", "expense", 2_000, { occurred_on: "2025-02-10" })];
  assert.ok(validateEntry(workspace, draftFrom(early)).entry);
  assert.deepEqual(historicalAccounts(workspace, draftFrom(transfer)).map(row => row.id), ["bank"]);
  const report = monthly(workspace, month);
  assert.equal(report.spending, 14_000);
  assert.equal(report.accounts.find(row => row.account.id === "bank").value, 98_000);
  assert.equal(report.accounts.find(row => row.account.id === "wallet").value, 5_000);
});

test("formats money fields with comma grouping while preserving legacy IDR entry and exact minor units", () => {
  assert.equal(formatMoneyInput("1.234,50", "IDR"), "1,234.50");
  assert.equal(parseMoney("1,234.50", "IDR"), 123450);
  assert.equal(formatMoneyInput("125000", "JPY"), "125,000");
  assert.equal(formatMoneyInput("90071992547409.91", "USD"), "90,071,992,547,409.91");
  assert.equal(formatMoneyInput("1.003", "KWD"), "1.003");
  assert.equal(groupNumber("-123456.09"), "-123,456.09");
});

test("a year includes only that year's activity and snapshots keep earlier balances", () => {
  const workspace = setup();
  workspace.transactions = [
    entry("previous", "income", 5_000, { occurred_on: "2024-12-15" }),
    entry("jan", "income", 8_000, { occurred_on: "2025-01-05" }),
    entry("feb", "expense", 4_000),
    entry("next", "income", 10_000, { occurred_on: "2026-01-01" }),
  ];
  assert.deepEqual(activity(workspace, "2025").map(row => row.id), ["feb", "jan"]);
  assert.equal(periodReport(workspace, "2025").income, 8_000);
  assert.equal(periodReport(workspace, "2025").cash, 104_000);
  assert.equal(periodReport(workspace, "all").income, 23_000);
  assert.equal(periodReport(workspace, "all").cash, 114_000);
});

test("cash statements reconcile account openings, historic entries, transfers, investments and payments", () => {
  const workspace = setup();
  workspace.accounts[1].opening_date = "2025-02-03";
  workspace.accounts[1].opening_minor = 6_000;
  workspace.transactions = [
    entry("before-opening", "expense", 1_000, { account_id: "wallet", occurred_on: "2025-02-01" }),
    entry("salary", "income", 20_000),
    entry("trip", "expense", 7_000, { reimbursable_minor: 5_000, counterparty: "Team" }),
    entry("internal", "transfer", 9_000, { destination_account_id: "wallet" }),
    entry("buy fund", "investment_contribution", 10_000, { destination_account_id: "fund" }),
  ];
  workspace.reimbursement_receipts = [{ id: "payment", expense_id: "trip", account_id: "wallet", received_on: "2025-02-08", amount_minor: 3_000 }];
  const ledger = cashLedger(workspace, month, "IDR");
  assert.deepEqual([ledger.start, ledger.openings, ledger.inflow, ledger.outflow, ledger.end], [100_000, 6_000, 23_000, 17_000, 112_000]);
  assert.equal(ledger.end, periodReport(workspace, month).cash);
  assert.equal(ledger.rows.find(item => item.row?.id === "before-opening").change, 0);
  assert.equal(ledger.rows.find(item => item.row?.id === "internal").change, 0);
});

test("a reimbursement saves null for an empty or whitespace-only due date", () => {
  const workspace = setup();
  const draft = draftFrom(entry("claim", "expense", 3_000, { reimbursable_minor: 2_000, counterparty: "Team" }));
  for (const due_on of [null, "", "   "]) assert.equal(validateEntry(workspace, { ...draft, due_on }).entry.due_on, null);
  assert.match(validateEntry(workspace, { ...draft, due_on: "2025-02-01" }).errors.due_on, /on or after/);
});

test("the form distinguishes partial, full and non-reimbursable expenses", () => {
  const workspace = setup();
  const draft = { ...draftFrom(entry("claim", "expense", 10_000)), counterparty: "Team", reimbursable: "20" };
  assert.equal(validateFormEntry(workspace, draft, "partial").entry.reimbursable_minor, 2_000);
  const full = validateFormEntry(workspace, { ...draft, amount: "140" }, "full").entry;
  assert.equal(full.reimbursable_minor, 14_000);
  assert.equal(full.due_on, null);
  assert.match(validateFormEntry(workspace, { ...draft, reimbursable: "" }, "partial").errors.reimbursable, /greater than zero/);
  assert.match(validateFormEntry(workspace, { ...draft, reimbursable: draft.amount }, "partial").errors.reimbursable, /less than the expense/);
  assert.match(validateFormEntry(workspace, { ...draft, counterparty: "" }, "full").errors.counterparty, /owes/);
  const ordinary = validateFormEntry(workspace, draft, "none").entry;
  assert.deepEqual([ordinary.reimbursable_minor, ordinary.counterparty], [0, ""]);
});

test("spreadsheet validation requires the five core fields and allows blank custom fields", () => {
  const workspace = setup();
  workspace.field_definitions = [{ id: "ref", label: "Reference", field_type: "text", options: [], required: true, position: 0, archived: false }];
  const draft = draftFrom(entry("batch", "expense", 35_000));
  assert.ok(validateEntry(workspace, draft, { requireCustomFields: false }).entry);
  assert.match(validateEntry(workspace, draft).errors.ref, /Complete/);
  for (const key of ["occurred_on", "kind", "description", "amount", "account_id"]) {
    const result = validateEntry(workspace, { ...draft, [key]: "" }, { requireCustomFields: false });
    assert.ok(result.errors[key], key);
  }
  assert.ok(validateEntry(workspace, { ...draft, kind: "transfer" }, { requireCustomFields: false }).errors.destination_account_id);
});

test("spreadsheet Full reimbursement follows the expense amount and requires the person who owes it", () => {
  const workspace = setup();
  const draft = { ...draftFrom(entry("batch", "expense", 35_000)), reimbursable: "Full" };
  assert.ok(validateEntry(workspace, draft).errors.counterparty);
  const row = { ...draft, counterparty: "Sam" };
  assert.equal(validateEntry(workspace, row).entry.reimbursable_minor, 35_000);
  assert.equal(validateEntry(workspace, { ...row, amount: "250.00" }).entry.reimbursable_minor, 25_000);
});

test("the assistant extracts Indonesian named dates and edits a draft without guessing between accounts", () => {
  const workspace = setup();
  workspace.accounts[0].name = "BCA";
  const today = "2026-11-10";
  let next = quickEntry(workspace, "Beli Nasi Goreng Pondok Reagan Rp47900 di tanggal 3 okt 2026", "IDR", today);
  assert.deepEqual([next.draft.description, next.draft.occurred_on, next.draft.amount, next.draft.account_id],
    ["Nasi Goreng Pondok Reagan", "2026-10-03", "47.900", ""]);
  next = reviseQuickEntry(workspace, next, "pakai BCA", today);
  next = reviseQuickEntry(workspace, next, "ubah tanggal ke 4 Okt 2026", today);
  next = reviseQuickEntry(workspace, next, "ganti jumlah ke Rp 52.000", today);
  assert.equal(next.draft.occurred_on, "2026-10-04");
  assert.equal(validateEntry(workspace, next.draft).entry.amount_minor, 5_200_000);
  assert.throws(() => quickEntry(workspace, "Beli nasi Rp10000 31 Feb 2026", "IDR", today), /valid date/);
});
