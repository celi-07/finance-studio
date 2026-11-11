import type { Activity, Currency, Workspace } from "./ledger.ts";
import { accountName, activity, activityLabel, amountText, balanceUpdateTitle, balances, cashLedger, currencyLabel, dayLabel, formatMoneyInput, inPeriod, periodReport, periodLabel, periodStart, receiptClaimKey, reimbursementReport, today, workspaceForCurrency } from "./ledger.ts";

export type StatementKind = "overview" | "transactions" | "reimbursements" | "investments";
const titles: Record<StatementKind, string> = {
  overview: "Financial overview", transactions: "Transaction statement",
  reimbursements: "Reimbursement statement", investments: "Investment statement",
};
const screenNames: Record<StatementKind, string> = {
  overview: "Overview", transactions: "Transactions",
  reimbursements: "Reimbursement", investments: "Investments",
};
const filenameDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const fontFiles = ["PlusJakartaSans-Regular.ttf", "PlusJakartaSans-Bold.ttf", "DejaVuSans.ttf"] as const;
const primaryFont = "PlusJakartaSans-Regular";
const boldFont = "PlusJakartaSans-Bold";
const fallbackFont = "DejaVuSans";

async function loadFont(file: string) {
  const response = await fetch("/" + file);
  if (!response.ok) throw Error("The statement font could not be loaded. Try the download again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

type StatementFilters = { activity?: Activity[]; people?: readonly string[] };

export async function downloadStatement(workspace: Workspace, period: string, currency: Currency, demo: boolean, kind: StatementKind, sheet?: string, filters?: StatementFilters) {
  const fonts = await Promise.all(fontFiles.map(loadFont));
  const pdf = await createStatement(workspace, period, currency, demo, fonts, kind, sheet, filters);
  pdf.save(`Finance Studio - ${screenNames[kind]} - ${filenameDate.format(new Date())}.pdf`);
}

type Columns = Record<number, { cellWidth?: number; halign?: "right" }>;

export async function createStatement(workspace: Workspace, period: string, currency: Currency, demo: boolean, fonts: readonly string[],
  kind: StatementKind, sheet?: string, { activity: filtered, people = [] }: StatementFilters = {}) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const scope = workspaceForCurrency(workspace, currency);
  const report = periodReport(scope, period, currency);
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true, putOnlyUsedFonts: true });
  fontFiles.forEach((file, index) => pdf.addFileToVFS(file, fonts[index]));
  pdf.addFont(fontFiles[0], primaryFont, "normal");
  pdf.addFont(fontFiles[1], boldFont, "bold");
  pdf.addFont(fontFiles[2], fallbackFont, "normal");
  pdf.setFont(primaryFont, "normal");
  const amountFont = pdf.getFont();
  const glyphs = amountFont.metadata as { characterToGlyph: (code: number) => number };
  const needsFallback = (text: string) => Array.from(text).some(char => char !== "\n" && !glyphs.characterToGlyph(char.codePointAt(0)!));
  const left = 16, right = 194, pageHeight = pdf.internal.pageSize.getHeight();
  const num = (amount: number) => (amount < 0 ? "−" : "") + currencyLabel(currency) + " "
    + formatMoneyInput(amountText(Math.abs(amount), currency) || "0", currency);
  const safe = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f]/g, " ");
  const plain = (text: string, size: number, x: number, y: number, align: "left" | "right" = "left") => {
    pdf.setFont(needsFallback(text) ? fallbackFont : primaryFont, "normal"); pdf.setFontSize(size); pdf.setTextColor(0);
    pdf.text(safe(text), x, y, { align });
  };
  const heading = (text: string, size: number, y: number) => {
    pdf.setFont(boldFont, "bold"); pdf.setFontSize(size); pdf.setTextColor(0);
    pdf.text(text, left, y);
  };

  pdf.setProperties({ title: titles[kind] + " - " + periodLabel(period) + " - " + currency, creator: "Finance Studio" });
  heading("FINANCE STUDIO", 10, 20);
  plain("Issued " + dayLabel(today()), 8, right, 20, "right");
  heading(titles[kind], 24, 32);
  plain(periodLabel(period) + "   /   " + currency + (demo ? "   /   DEMO DATA" : ""), 10, left, 39);
  let cursor = 48;
  const captions = sheet ? ["Finance sheet   " + sheet] : [];
  if (kind === "reimbursements") captions.push("People   " + (people.length > 3 ? people.length + " selected people" : people.join(", ") || "All people"));
  let captionY = 46;
  for (const text of captions) {
    const caption = safe(text).replace(/\n/g, " ");
    pdf.setFont(needsFallback(caption) ? fallbackFont : primaryFont, "normal"); pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(caption, right - left) as string[];
    for (const line of lines) {
      plain(line, 9, left, captionY);
      captionY += 4;
    }
    cursor = captionY + 6;
  }

  function block(title: string, head: string[], body: string[][], columns: Columns = {}, summary: string[][] = []) {
    if (cursor > pageHeight - 44) { pdf.addPage(); cursor = 19; }
    heading(title, 11, cursor);
    autoTable(pdf, {
      theme: "plain", startY: cursor + 3, margin: { left, right: left, top: 17, bottom: 18 },
      head: [head], body: body.map(row => row.map(safe)), foot: summary.map(row => row.map(safe)), columnStyles: columns,
      styles: { font: primaryFont, textColor: 0, lineColor: 0, lineWidth: 0, fillColor: false,
        fontSize: 8, cellPadding: { top: 1.7, right: 1.4, bottom: 1.7, left: 1.4 }, overflow: "linebreak" },
      headStyles: { font: boldFont, fontStyle: "bold", fillColor: false },
      footStyles: { fontStyle: "normal", fillColor: false },
      showHead: "everyPage", showFoot: "lastPage", rowPageBreak: "avoid",
      didParseCell: ({ section, column, cell, row }) => {
        if (cell.text.some(needsFallback)) {
          cell.styles.font = fallbackFont;
          cell.styles.fontStyle = "normal";
        }
        const col = columns[column.index];
        if (col?.halign) {
          cell.styles.halign = col.halign;
          if (section !== "head" && col.cellWidth) {
            const longest = Math.max(...cell.text.map(line => pdf.getStringUnitWidth(line, { font: amountFont })), 0);
            const available = (col.cellWidth - 2.8) * pdf.internal.scaleFactor;
            if (longest * cell.styles.fontSize > available) cell.styles.fontSize = Math.max(5, available / longest);
          }
        }
        if (section === "foot" && row.index === 0) cell.styles.lineWidth = { top: .2 };
      },
    });
    cursor = (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  const labels = new Map(scope.field_definitions.map(field => [field.id, field.label]));
  function entryDetails(rows: Activity[]) {
    const details = rows.toSorted((a, b) => a.date.localeCompare(b.date)).flatMap(row => {
      const values = Object.entries(row.entry?.custom_values ?? {}).map(([id, value]) => [
        labels.get(id) ?? "Custom field", typeof value === "boolean" ? value ? "Yes" : "No" : String(value),
      ]);
      const notes = row.entry?.notes || row.receipt?.notes;
      if (notes) values.unshift(["Notes", notes]);
      return values.map(([label, value]) => [row.date, row.title, label, value]);
    });
    if (details.length) block("Entry details", ["Date", "Entry", "Field", "Value"], details, { 0: { cellWidth: 24 }, 1: { cellWidth: 45 }, 2: { cellWidth: 34 } });
  }
  function accountPath(row: Activity) {
    return accountName(scope, row.accountId) + (row.entry?.destination_account_id ? " > " + accountName(scope, row.entry.destination_account_id) : "");
  }
  const amountColumn = { halign: "right" as const, cellWidth: 37 };

  if (kind === "transactions") {
    const cash = cashLedger(scope, period, currency);
    const included = filtered ? new Set(filtered.map(row => row.id)) : null;
    const rows = cash.rows.filter(item => !item.row || !included || included.has(item.row.id));
    if (filtered) {
      plain("Filtered activity. Running balances and summary cover the full period.", 8, left, cursor);
      cursor += 9;
    }
    const entries = rows.map(({ date, row, account, opening, change, balance }) => [
        date, row ? row.title + "\n" + activityLabel(row) + (row.category === activityLabel(row) ? "" : " / " + row.category) + " / " + accountPath(row) : "Account opening balance\n" + account,
        row ? num(Math.abs(row.amount)) : num(opening), change < 0 ? num(-change) : "", change > 0 && !opening ? num(change) : "", num(balance),
    ]);
    block("Cash ledger", ["Date", "Description / account", "Recorded", "Money out", "Money in", "Balance"],
      [["", "Opening cash balance", "", "", "", num(cash.start)], ...(entries.length ? entries : [["", "No matching activity", "", "", "", ""]])],
      { 0: { cellWidth: 23 }, 2: { halign: "right", cellWidth: 24 }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 24 }, 5: { halign: "right", cellWidth: 27 } },
      [
        ["", "Opening cash balance", "", "", "", num(cash.start)],
        ["", "Account opening balances added", "", "", "", num(cash.openings)],
        ["", "Cash movement totals", "", num(cash.outflow), num(cash.inflow), ""],
        ["", "Closing cash balance", "", "", "", num(cash.end)],
      ]);
    entryDetails(rows.flatMap(item => item.row ? [item.row] : []));
  }

  if (kind === "overview") {
    block("Financial summary", ["Measure", "Amount"], [
      ["Income", num(report.income)], ["Gross expenses paid", num(report.gross)], ["Personal spending", num(report.spending)],
      ["Reimbursements received", num(report.collected)], ["Reimbursements outstanding", num(report.receivable)],
      ["Investment contributions", num(report.contribution)], ["Investment withdrawals", num(report.withdrawal)],
      ["Estimated investment value", num(report.invested)], ["Cash inflow", num(report.cashIn)], ["Cash outflow", num(report.cashOut)], ["Net cash movement", num(report.netCashFlow)],
    ], { 1: amountColumn }, [["Closing cash balance", num(report.cash)]]);
    block("Personal spending by category", ["Category", "Personal share"], report.categories.length
      ? report.categories.map(category => [category.name, num(category.amount)]) : [["No spending this period", num(0)]], { 1: amountColumn });
    const rows = activity(scope, period, currency).toSorted((a, b) => a.date.localeCompare(b.date));
    block("Transaction activity", ["Date", "Description", "Type / category", "Account", "Amount"],
      rows.length ? rows.map(row => [row.date, row.title, row.category === activityLabel(row) ? row.category : activityLabel(row) + "\n" + row.category,
        accountPath(row), (row.amount > 0 && row.kind !== "transfer" ? "+" : "") + num(row.amount)]) : [["", "No matching entries", "", "", ""]],
      { 0: { cellWidth: 23 }, 2: { cellWidth: 35 }, 3: { cellWidth: 33 }, 4: { halign: "right", cellWidth: 27 } });
    entryDetails(rows);
  }

  if (kind === "overview" || kind === "reimbursements") {
    const reimbursements = kind === "reimbursements" ? reimbursementReport(scope, period, people) : null;
    const relevant = (reimbursements?.claims ?? report.claims)
      .toSorted((a, b) => a.entry.occurred_on.localeCompare(b.entry.occurred_on));
    block(kind === "overview" ? "Reimbursements at period end" : "Claims and balances", ["Date / due", "Expense / counterparty", "Status", "Claimed", "Received", "Outstanding"],
      relevant.length ? relevant.map(claim => [
        claim.entry.occurred_on + (claim.due_on ? "\nDue " + claim.due_on : ""),
        claim.entry.description + "\n" + claim.counterparty, claim.status,
        num(claim.amount_minor), num(claim.paid), num(claim.remaining),
      ]) : [["", "No claims in this view", "", "", "", ""]],
      { 0: { cellWidth: 31 }, 2: { cellWidth: 18 }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 24 }, 5: { halign: "right", cellWidth: 26 } },
      reimbursements ? [["", "Total outstanding", "", "", "", num(reimbursements.outstanding)]] : []);
    if (reimbursements) {
      const descriptions = new Map(relevant.map(claim => [claim.key, claim.entry.description + "\n" + claim.counterparty]));
      block("Payments received in period", ["Date", "Claim / notes", "Deposit account", "Amount"],
        reimbursements.receipts.length ? reimbursements.receipts.toSorted((a, b) => a.received_on.localeCompare(b.received_on)).map(row => [
          row.received_on, (descriptions.get(receiptClaimKey(row)) ?? "Reimbursement") + (row.notes ? "\n" + row.notes : ""),
          accountName(scope, row.account_id), num(row.amount_minor),
        ]) : [["", "No payments received", "", ""]],
        { 0: { cellWidth: 24 }, 2: { cellWidth: 38 }, 3: amountColumn }, [["", "Total received", "", num(reimbursements.collected)]]);
    }
  }

  if (kind === "overview" || kind === "investments") {
    const holdings = report.accounts.filter(row => row.account.kind === "investment");
    if (kind === "overview") {
      block("Investments at period end", ["Holding", "Contributed balance", "Estimated value"], holdings.length
        ? holdings.map(row => [row.account.name, num(row.basis), num(row.value)]) : [["No investment accounts", "", ""]],
        { 1: amountColumn, 2: amountColumn });
    } else {
      const prior = new Map(balances(scope, periodStart(period)).map(row => [row.account.id, row.value]));
      block("Investment holdings", ["Holding / last valuation", "Opening estimate", "Contributed balance", "Closing estimate"],
        holdings.length ? holdings.toSorted((a, b) => (a.valuation?.valued_on ?? "9999-99-99").localeCompare(b.valuation?.valued_on ?? "9999-99-99")).map(({ account, basis, value, valuation }) => [
          account.name + (valuation ? "\nValued " + valuation.valued_on : ""), num(prior.get(account.id) ?? 0), num(basis), num(value),
        ]) : [["No investment accounts", "", "", ""]],
        { 1: amountColumn, 2: amountColumn, 3: amountColumn },
        [["Estimated portfolio value", num(holdings.reduce((sum, row) => sum + (prior.get(row.account.id) ?? 0), 0)), "", num(report.invested)]]);
      const rows = activity(scope, period, currency).filter(row => row.kind === "investment_contribution" || row.kind === "investment_withdrawal")
        .toSorted((a, b) => a.date.localeCompare(b.date));
      block("Investment movements in period", ["Date", "Description / account", "Contributed", "Withdrawn"], rows.length ? rows.map(row => [
        row.date, row.title + "\n" + accountPath(row),
        row.kind === "investment_contribution" ? num(Math.abs(row.amount)) : "",
        row.kind === "investment_withdrawal" ? num(Math.abs(row.amount)) : "",
      ]) : [["", "No investment movements", "", ""]], { 0: { cellWidth: 24 }, 2: amountColumn, 3: amountColumn },
      [["", "Period totals", num(report.contribution), num(report.withdrawal)]]);
      entryDetails(rows);
      const valuations = scope.investment_valuations.filter(row => inPeriod(row.valued_on, period)).toSorted((a, b) => a.valued_on.localeCompare(b.valued_on));
      if (valuations.length) block("Valuations recorded in period", ["Date", "Holding", "Value"],
        valuations.map(row => [row.valued_on, accountName(scope, row.investment_account_id), num(row.value_minor)]), { 0: { cellWidth: 24 }, 2: amountColumn });
      const updates = report.adjustments.filter(row => row.investment).toSorted((a, b) => a.update.recorded_on.localeCompare(b.update.recorded_on));
      if (updates.length) block("Investment balance updates", ["Date", "Holding / update", "Change", "Recorded value"],
        updates.map(({ update, difference }) => [update.recorded_on,
          accountName(scope, update.account_id) + "\n" + balanceUpdateTitle(update.frequency, difference, true),
          num(difference), num(update.balance_minor)]), { 0: { cellWidth: 24 }, 2: amountColumn, 3: amountColumn });
    }
  }

  const count = pdf.getNumberOfPages();
  for (let number = 1; number <= count; number += 1) {
    pdf.setPage(number);
    plain("Generated by Finance Studio", 7, left, pageHeight - 12);
    plain("Finance Studio @whiteeorangee", 8, left, pageHeight - 7);
    plain(number + " / " + count, 8, right, pageHeight - 7, "right");
  }
  return pdf;
}
