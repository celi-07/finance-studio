import type { Activity, Workspace } from "./ledger";
import { accountName, activity, activityLabel, activityMoney, dayLabel, money, monthly, monthLabel, today } from "./ledger";

export async function downloadStatement(workspace: Workspace, month: string, demo: boolean, filtered?: Activity[]) {
  const response = await fetch("/DejaVuSans.ttf");
  if (!response.ok) throw Error("The statement font could not be loaded. Try the download again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  const pdf = await createStatement(workspace, month, demo, btoa(binary), filtered);
  pdf.save("ledger-statement-" + month + (demo ? "-demo" : "") + ".pdf");
}

export async function createStatement(workspace: Workspace, month: string, demo: boolean, font: string, filtered?: Activity[]) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const report = monthly(workspace, month);
  const rows = filtered ?? activity(workspace, month);
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("DejaVuSans.ttf", font);
  pdf.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
  const page = pdf.internal.pageSize;
  const ink = "#102720";
  const muted = "#465d53";
  const leaf = "#16704f";
  const num = (amount: number) => money(amount).replace(/\u00a0/g, " ");
  const safe = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f]/g, " ");
  pdf.setProperties({ title: "Ledger Monthly Statement - " + monthLabel(month), creator: "Ledger" });
  pdf.setFillColor(ink); pdf.roundedRect(15, 16, 180, 38, 3, 3, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor("#c2eed7");
  pdf.text("LEDGER  /  PERSONAL FINANCE", 21, 25);
  pdf.setTextColor("#ffffff"); pdf.setFontSize(23); pdf.text("Monthly Statement", 21, 37);
  pdf.setFontSize(10); pdf.setFont("helvetica", "normal");
  pdf.text(monthLabel(month) + "  |  IDR  |  Asia/Jakarta", 21, 46);
  pdf.setTextColor(muted); pdf.setFontSize(9); pdf.text("Generated " + dayLabel(today()), 15, 62);
  if (demo) { pdf.setFont("helvetica", "bold"); pdf.setTextColor("#8b4b10"); pdf.text("DEMO DATA", 195, 62, { align: "right" }); }
  const style = { font: "DejaVuSans", textColor: ink, fontSize: 9, cellPadding: 2.5, overflow: "linebreak" as const };
  let cursor = 69;
  function block(title: string, head: string[], body: string[][], widths?: Record<number, { cellWidth?: number; halign?: "right" }>) {
    if (cursor > page.getHeight() - 35) { pdf.addPage(); cursor = 20; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(leaf); pdf.text(title, 15, cursor);
    autoTable(pdf, {
      startY: cursor + 4, margin: { left: 15, right: 15, top: 17, bottom: 17 },
      head: [head.map(safe)], body: body.map(row => row.map(safe)), styles: style,
      headStyles: { fillColor: leaf, textColor: "#ffffff", fontStyle: "normal" }, alternateRowStyles: { fillColor: "#f0f7f2" },
      columnStyles: widths, showHead: "everyPage", rowPageBreak: "avoid",
      didParseCell: ({ section, column, cell }) => {
        if (section === "head" && widths?.[column.index]?.halign) cell.styles.halign = "right";
      },
    });
    cursor = ((pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 11;
  }
  block("Full-month summary", ["Summary", "Amount"], [
    ["Cash balance at month end", num(report.cash)], ["Income", num(report.income)],
    ["Gross expenses paid", num(report.gross)], ["Personal spending", num(report.spending)],
    ["Reimbursements received", num(report.collected)], ["Reimbursements outstanding", num(report.receivable)],
    ["Investment contributions", num(report.contribution)], ["Investment withdrawals", num(report.withdrawal)],
    ["Estimated investments at month end", num(report.invested)], ["Net cash movement", num(report.netCashFlow)],
  ], { 1: { halign: "right", cellWidth: 50 } });
  block("Personal spending by category", ["Category", "Personal share"], report.categories.length ? report.categories.map(category => [category.name, num(category.amount)]) : [["No spending this month", num(0)]], { 1: { halign: "right", cellWidth: 50 } });
  block(filtered ? "Filtered transaction activity" : "Transaction activity", ["Date", "Description", "Type / category", "Account", "Amount"],
    rows.length ? rows.map(row => [
      row.date, row.title, row.category === activityLabel(row) ? row.category : activityLabel(row) + "\n" + row.category,
      accountName(workspace, row.accountId) + (row.entry?.destination_account_id ? " > " + accountName(workspace, row.entry.destination_account_id) : ""),
      activityMoney(row).replace(/\u00a0/g, " "),
    ]) : [["", "No matching entries", "", "", ""]], { 0: { cellWidth: 27 }, 2: { cellWidth: 38 }, 3: { cellWidth: 35 }, 4: { halign: "right", cellWidth: 34 } });
  const labels = new Map(workspace.field_definitions.map(field => [field.id, field.label]));
  const details = rows.flatMap(row => {
    const values = Object.entries(row.entry?.custom_values ?? {}).map(([id, value]) => [
      labels.get(id) ?? "Custom field", typeof value === "boolean" ? value ? "Yes" : "No" : String(value),
    ]);
    const notes = row.entry?.notes || row.receipt?.notes;
    if (notes) values.unshift(["Notes", notes]);
    return values.map(([label, value]) => [row.date, row.title, label, value]);
  });
  if (details.length) block("Entry details", ["Date", "Entry", "Field", "Value"], details, { 0: { cellWidth: 27 }, 1: { cellWidth: 46 }, 2: { cellWidth: 32 } });
  block("Reimbursements at month end", ["Expense / counterparty", "Status", "Claimed", "Received", "Outstanding"],
    report.claims.length ? report.claims.map(claim => [
      claim.entry.description + " / " + claim.entry.counterparty, claim.status,
      num(claim.entry.reimbursable_minor), num(claim.paid), num(claim.remaining),
    ]) : [["No claims", "", "", "", ""]], { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } });
  const holdings = report.accounts.filter(row => row.account.kind === "investment");
  block("Investments at month end", ["Holding", "Contributed balance", "Estimated value"], holdings.length
    ? holdings.map(row => [row.account.name, num(row.basis), num(row.value)]) : [["No investment accounts", num(0), num(0)]],
    { 1: { halign: "right" }, 2: { halign: "right" } });
  block("Cash movement totals", ["Movement", "Amount"], [
    ["Cash inflow", num(report.cashIn)], ["Cash outflow", num(report.cashOut)], ["Net cash movement", num(report.netCashFlow)],
  ], { 1: { halign: "right", cellWidth: 50 } });
  const count = pdf.getNumberOfPages();
  for (let number = 1; number <= count; number += 1) {
    pdf.setPage(number);
    pdf.setDrawColor("#d1ded6"); pdf.line(15, page.getHeight() - 13, 195, page.getHeight() - 13);
    pdf.setTextColor(muted); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.text("Ledger Monthly Statement  |  " + monthLabel(month) + (demo ? "  |  Demo data" : ""), 15, page.getHeight() - 8);
    pdf.text(number + " / " + count, 195, page.getHeight() - 8, { align: "right" });
  }
  return pdf;
}
