import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { emptyWorkspace, periodReport, workspaceForBook } from "../lib/ledger.ts";
import { createStatement, overviewCashSummary } from "../lib/statement.ts";
import { statementWorkspace } from "./fixtures/statement-workspace.mjs";

test("overview reconciles nonzero opening cash, new accounts, transfers, linked repayments and balance checks", () => {
  const workspace = workspaceForBook(statementWorkspace(), "");
  const result = overviewCashSummary(workspace, "2026-10", "IDR");
  assert.deepEqual([result.opening, result.accountOpenings, result.inflow, result.outflow, result.netMovement, result.closing], [105000, 25000, 60000, 20000, 40000, 170000]);
  assert.equal(result.closing, periodReport(workspace, "2026-10", "IDR").cash);
  assert.equal(result.opening + result.accountOpenings + result.inflow - result.outflow, result.closing);
  assert.notEqual(result.netMovement, result.closing);
  assert.deepEqual(result.accounts.map(row => [row.account.id, row.opening, row.change, row.closing]), [
    ["bank", 100000, 30000, 130000], ["wallet", 0, 35000, 35000], ["cash", 5000, 0, 5000], ["future", 0, 0, 0],
  ]);
  assert.equal(result.accounts.reduce((sum, row) => sum + row.closing, 0), result.closing);
});

test("overview account balances preserve currency and sheet scope and include archived balances", () => {
  const workspace = statementWorkspace();
  const personal = workspaceForBook(workspace, "");
  assert.equal(overviewCashSummary(workspace, "2026-10", "IDR").closing, 1070000);
  assert.equal(overviewCashSummary(workspaceForBook(workspace, "business"), "2026-10", "IDR").closing, 900000);
  const usd = overviewCashSummary(personal, "2026-10", "USD");
  assert.equal(usd.opening, 9876); assert.equal(usd.closing, 9876); assert.equal(usd.inflow, 0); assert.equal(usd.outflow, 0);
  assert.deepEqual(usd.accounts.map(row => row.account.id), ["usd"]);
  assert.equal(overviewCashSummary(personal, "2026-10", "IDR").accounts.find(row => row.account.archived).closing, 5000);
});

test("overview reconciliation remains exact for monthly, yearly, all-history and empty reports", () => {
  const workspace = workspaceForBook(statementWorkspace(), "");
  for (const period of ["2026-09", "2026-10", "2026-11", "2026", "all"]) {
    const cash = overviewCashSummary(workspace, period, "IDR");
    assert.equal(cash.closing, periodReport(workspace, period, "IDR").cash);
    assert.equal(cash.opening + cash.accountOpenings + cash.inflow - cash.outflow, cash.closing);
    assert.equal(cash.accounts.reduce((sum, row) => sum + row.opening, 0), cash.opening);
    assert.equal(cash.accounts.reduce((sum, row) => sum + row.change, 0), cash.accountOpenings + cash.netMovement);
  }
  const empty = overviewCashSummary(emptyWorkspace, "all", "IDR");
  assert.equal(empty.closing, 0); assert.deepEqual(empty.accounts, []);
});

test("all-currency Overview PDF includes separate currency sections in a single document", async () => {
  const fonts = ["PlusJakartaSans-Regular.ttf", "PlusJakartaSans-Bold.ttf", "DejaVuSans.ttf"].map(name => readFileSync(new URL("../public/" + name, import.meta.url)).toString("base64"));
  const workspace = workspaceForBook(statementWorkspace(), "");
  const single = await createStatement(workspace, "2026-10", "IDR", true, fonts, "overview", "Personal");
  const multi = await createStatement(workspace, "2026-10", "IDR", true, fonts, "overview", "Personal", { currencies: ["IDR", "USD", "IDR"] });
  const dollars = await createStatement(workspace, "2026-10", "USD", true, fonts, "overview", "Personal");
  assert.equal(multi.getNumberOfPages(), single.getNumberOfPages() + dollars.getNumberOfPages());
  assert.ok(multi.output("arraybuffer").byteLength > single.output("arraybuffer").byteLength);
});
