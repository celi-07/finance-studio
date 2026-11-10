import type { Activity, Currency, Workspace } from "./ledger";
import { accountName, activity, activityLabel, activityMoney, dayLabel, money, periodReport, periodLabel, today } from "./ledger";

export async function downloadStatement(workspace: Workspace, period: string, currency: Currency, demo: boolean, filtered?: Activity[], sheet?: string) {
  const response = await fetch("/DejaVuSans.ttf");
  if (!response.ok) throw Error("The statement font could not be loaded. Try the download again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  const pdf = await createStatement(workspace, period, currency, demo, btoa(binary), filtered, sheet);
  const sheetSlug = sheet?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  pdf.save(["finance-studio", sheetSlug, period, currency.toLowerCase(), demo ? "demo" : ""].filter(Boolean).join("-") + ".pdf");
}

export async function createStatement(workspace: Workspace, period: string, currency: Currency, demo: boolean, font: string, filtered?: Activity[], sheet?: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const report = periodReport(workspace, period, currency);
  const rows = filtered ?? activity(workspace, period, currency);
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("DejaVuSans.ttf", font);
  pdf.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
  const page = pdf.internal.pageSize;
  const ink = "#1b2333";
  const muted = "#546077";
  const accent = "#234fca";
  const num = (amount: number) => money(amount, currency).replace(/\u00a0/g, " ");
  const safe = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f]/g, " ");
  pdf.setProperties({ title: "Finance Studio Statement - " + periodLabel(period) + " - " + currency, creator: "Finance Studio" });
  pdf.setFillColor("#161616"); pdf.roundedRect(15, 16, 8, 8, 2.1, 2.1, "F");
  pdf.setFillColor("#639aee"); pdf.roundedRect(17, 18, 2, 2, .5, .5, "F");
  pdf.setFillColor("#4878c9"); pdf.roundedRect(19.6, 18, 1.4, 1.4, .4, .4, "F");
  pdf.roundedRect(17, 20.6, 1.4, 1.4, .4, .4, "F");
  pdf.setFillColor("#91c5f5"); pdf.roundedRect(19, 20, 2, 2, .5, .5, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(ink);
  pdf.text("Finance Studio", 26, 21.6);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(muted); pdf.setFontSize(9);
  pdf.text("Issued " + dayLabel(today()), 195, 21.6, { align: "right" });
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(ink); pdf.setFontSize(25);
  pdf.text("Statement", 15, 38);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(muted); pdf.setFontSize(10);
  pdf.text(periodLabel(period) + "  /  " + currency, 15, 46);
  if (sheet) {
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
    pdf.text(safe(sheet).replace(/\n/g, " "), 78, 46, { maxWidth: demo ? 86 : 117 });
  }
  if (demo) { pdf.setFont("helvetica", "bold"); pdf.setTextColor(accent); pdf.text("DEMO DATA", 195, 46, { align: "right" }); }
  pdf.setFillColor("#eef2fb"); pdf.roundedRect(15, 52, 180, 20, 2, 2, "F");
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(muted);
  pdf.text("Cash balance at period end", 20, 64);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(17); pdf.setTextColor(ink);
  pdf.text(num(report.cash), 190, 64.7, { align: "right" });
  const style = { font: "DejaVuSans", textColor: ink, fontSize: 9, cellPadding: 2.5, overflow: "linebreak" as const };
  let cursor = 82;
  function block(title: string, head: string[], body: string[][], widths?: Record<number, { cellWidth?: number; halign?: "right" }>) {
    if (cursor > page.getHeight() - 49) { pdf.addPage(); cursor = 20; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(ink); pdf.text(title, 15, cursor);
    autoTable(pdf, {
      startY: cursor + 4, margin: { left: 15, right: 15, top: 17, bottom: 17 },
      head: [head.map(safe)], body: body.map(row => row.map(safe)), styles: style,
      headStyles: { fillColor: "#e9eef8", textColor: ink, fontStyle: "normal" }, alternateRowStyles: { fillColor: "#f6f8fc" },
      columnStyles: widths, showHead: "everyPage", rowPageBreak: "avoid",
      didParseCell: ({ section, column, cell }) => {
        if (section === "head" && widths?.[column.index]?.halign) cell.styles.halign = "right";
      },
    });
    cursor = ((pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 11;
  }
  block("Period summary", ["Summary", "Amount"], [
    ["Income", num(report.income)],
    ["Gross expenses paid", num(report.gross)], ["Personal spending", num(report.spending)],
    ["Reimbursements received", num(report.collected)], ["Reimbursements outstanding", num(report.receivable)],
    ["Investment contributions", num(report.contribution)], ["Investment withdrawals", num(report.withdrawal)],
    ["Estimated investments at period end", num(report.invested)], ["Net cash movement", num(report.netCashFlow)],
  ], { 1: { halign: "right", cellWidth: 50 } });
  block("Personal spending by category", ["Category", "Personal share"], report.categories.length ? report.categories.map(category => [category.name, num(category.amount)]) : [["No spending this period", num(0)]], { 1: { halign: "right", cellWidth: 50 } });
  block(filtered ? "Filtered transaction activity" : "Transaction activity", ["Date", "Description", "Type / category", "Account", "Amount"],
    rows.length ? rows.map(row => [
      row.date, row.title, row.category === activityLabel(row) ? row.category : activityLabel(row) + "\n" + row.category,
      accountName(workspace, row.accountId) + (row.entry?.destination_account_id ? " > " + accountName(workspace, row.entry.destination_account_id) : ""),
      activityMoney(row, currency).replace(/\u00a0/g, " "),
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
  block("Reimbursements at period end", ["Expense / counterparty", "Status", "Claimed", "Received", "Outstanding"],
    report.claims.length ? report.claims.map(claim => [
      claim.entry.description + " / " + claim.entry.counterparty, claim.status,
      num(claim.entry.reimbursable_minor), num(claim.paid), num(claim.remaining),
    ]) : [["No claims", "", "", "", ""]], { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } });
  const holdings = report.accounts.filter(row => row.account.kind === "investment");
  block("Investments at period end", ["Holding", "Contributed balance", "Estimated value"], holdings.length
    ? holdings.map(row => [row.account.name, num(row.basis), num(row.value)]) : [["No investment accounts", num(0), num(0)]],
    { 1: { halign: "right" }, 2: { halign: "right" } });
  block("Cash movement totals", ["Movement", "Amount"], [
    ["Cash inflow", num(report.cashIn)], ["Cash outflow", num(report.cashOut)], ["Net cash movement", num(report.netCashFlow)],
  ], { 1: { halign: "right", cellWidth: 50 } });
  const count = pdf.getNumberOfPages();
  for (let number = 1; number <= count; number += 1) {
    pdf.setPage(number);
    pdf.setDrawColor("#d7deea"); pdf.line(15, page.getHeight() - 13, 195, page.getHeight() - 13);
    pdf.setTextColor(muted); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.text("Finance Studio  |  " + periodLabel(period) + "  |  " + currency + (demo ? "  |  Demo data" : ""), 15, page.getHeight() - 8);
    pdf.text(number + " / " + count, 195, page.getHeight() - 8, { align: "right" });
  }
  return pdf;
}
