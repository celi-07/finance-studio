"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, CalendarDays, ChartSpline, ClipboardList,
  HandCoins, Landmark, Layers3, ListFilter, Plus, Search, ShoppingBag, WalletCards,
} from "lucide-react";
import {
  accountName, activity, claims, dayLabel, kinds, money, monthly, monthLabel, shiftMonth,
  type Activity, type Kind, type Workspace,
} from "@/lib/ledger";
import { accountIcons, accountTones, ActivityRow, Empty, palette } from "./ledger-ui";
import { Picker } from "./ledger-picker";

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function MovementChart({ workspace, month }: { workspace: Workspace; month: string }) {
  const [range, setRange] = useState(3);
  const months = Array.from({ length: range }, (_, index) => shiftMonth(month, index - range + 1));
  const series = months.map(period => ({ period, ...monthly(workspace, period) }));
  const max = Math.max(...series.map(item => Math.max(item.cashIn, item.cashOut)), 100);
  const exponent = 10 ** Math.floor(Math.log10(max));
  const scale = Math.ceil(max / exponent * 2) * exponent / 2;
  const axis = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  return <section className="flow-panel">
    <SectionHeading title="Cash movement" action={<div className="range-switch segmented" style={{ "--selection": range === 3 ? 0 : 1 } as CSSProperties} role="group" aria-label="Cash movement range">
      {[3, 6].map(count => <button type="button" key={count} aria-label={count + " months"} aria-pressed={range === count} onClick={() => setRange(count)}>{count}M</button>)}
    </div>}/>
    <div className="chart-legend"><span><i className="income-key"/> Inflow</span><span><i className="expense-key"/> Outflow</span><span className="chart-unit">IDR</span></div>
    <div className="chart" role="img" aria-label={series.map(row => monthLabel(row.period) + " inflow " + money(row.cashIn) + ", outflow " + money(row.cashOut)).join(". ")}>
      <div className="chart-ticks" aria-hidden="true">{[1, .75, .5, .25, 0].map(ratio => <span key={ratio}>{axis.format(scale * ratio / 100)}</span>)}</div>
      <div className="chart-body" aria-hidden="true">
        <div className="chart-lines"><i/><i/><i/><i/><i/></div>
        <div className="chart-groups" style={{ gridTemplateColumns: "repeat(" + range + ", minmax(0, 1fr))" }}>{series.map((row, index) => <div key={row.period} style={{ "--step": index } as CSSProperties} className={"chart-group" + (row.period === month ? " current" : "")}>
          <div className="chart-bars">
            <div className="chart-tip"><strong>{monthLabel(row.period)}</strong><span>In {money(row.cashIn)}</span><span>Out {money(row.cashOut)}</span></div>
            <i className="income-key" hidden={!row.cashIn} style={{ height: (row.cashIn / scale * 100) + "%" }}/><i className="expense-key" hidden={!row.cashOut} style={{ height: (row.cashOut / scale * 100) + "%" }}/>
          </div>
          <span>{monthLabel(row.period).slice(0, 3)}</span>
        </div>)}</div>
      </div>
    </div>
    <details className="chart-details">
      <summary>Monthly totals</summary>
      <dl>{series.toReversed().map(row => <div key={row.period}>
        <dt>{monthLabel(row.period)}</dt><dd>In {money(row.cashIn)}<br/>Out {money(row.cashOut)}</dd>
      </div>)}</dl>
    </details>
  </section>;
}

export function Overview({ workspace, month, onBrowse, onOpen, onAdd }: {
  workspace: Workspace; month: string; onBrowse: () => void; onOpen: (row: Activity) => void; onAdd: () => void;
}) {
  const report = monthly(workspace, month);
  const recent = activity(workspace, month).slice(0, 5);
  const prior = monthly(workspace, shiftMonth(month, -1));
  const change = report.netCashFlow - prior.netCashFlow;
  const metrics = [
    { name: "Income", amount: report.income, hint: "Income earned this month", icon: ArrowDownToLine, tone: "mint" },
    { name: "Personal spending", amount: report.spending, hint: money(report.gross) + " paid before claims", icon: ShoppingBag, tone: "coral" },
    { name: "Owed to you", amount: report.receivable, hint: report.claims.filter(claim => claim.remaining).length + " open claims at month end", icon: HandCoins, tone: "amber" },
  ];
  return <>
    <div className="overview-grid">
      <section className="panel cash-report" aria-label="Cash balance and movement">
        <div className="balance-header">
          <div className="balance-main">
            <span className="balance-label">Cash balance</span>
            <strong key={report.cash}>{money(report.cash)}</strong>
            <p>At the end of {monthLabel(month)}</p>
          </div>
          <div className="balance-delta">
            <span>Net cash flow</span>
            <strong key={report.netCashFlow}>{report.netCashFlow > 0 ? "+" : report.netCashFlow < 0 ? "−" : ""}{money(Math.abs(report.netCashFlow))}</strong>
            {!!(prior.cashIn || prior.cashOut) && <small>{change > 0 ? <ArrowUpRight size={14}/> : change < 0 ? <ArrowDownLeft size={14}/> : null}
              {change ? money(Math.abs(change)) + (change > 0 ? " higher" : " lower") + " than prior month" : "Same as prior month"}</small>}
          </div>
        </div>
        <MovementChart workspace={workspace} month={month}/>
      </section>
      <div className="overview-side">
        <section className="panel month-summary">
          <SectionHeading title="Monthly summary"/>
          <dl>{metrics.map(({ name, amount, hint, icon: Icon, tone }) => <div className="summary-row" key={name}>
            <dt><span className="glyph" data-tone={tone} aria-hidden="true"><Icon size={17}/></span><span>{name}<small>{hint}</small></span></dt>
            <dd>{money(amount)}</dd>
          </div>)}</dl>
        </section>
      <section className="panel spending-panel">
        <SectionHeading title="Spending breakdown" subtitle="Excludes amounts owed to you"/>
        {report.categories.length ? <ul className="category-bars">{report.categories.map((row, index) => <li key={row.id ?? "uncategorized"}>
          <div><span><i className={"category-dot " + (workspace.categories.find(category => category.id === row.id)?.color ?? palette[index % palette.length])}/>{row.name}</span><strong>{money(row.amount)}</strong></div>
          <div className="bar-track" aria-hidden="true"><i className={workspace.categories.find(category => category.id === row.id)?.color ?? palette[index % palette.length]} style={{ width: (row.amount / report.spending * 100) + "%" }}/></div>
        </li>)}</ul> : <Empty title="No spending yet" description="Expenses for this month will appear here." icon={Layers3}/>}
      </section>
      </div>
    </div>
    <div className="overview-lower">
    <section className="panel recent-panel">
      <SectionHeading title="Recent activity" action={<button className="button quiet" type="button" onClick={onBrowse}>View all <ArrowRight size={15}/></button>}/>
      {recent.length ? <div className="activity-list">{recent.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>)}</div>
        : <Empty title="No activity this month" description="Add an entry to start building this month’s record." action={<button type="button" className="button secondary" onClick={onAdd}><Plus size={16}/> Add entry</button>}/>}
    </section>
    <section className="panel account-section">
      <SectionHeading title="Accounts" subtitle="Month-end balances" />
      {report.accounts.length ? <div className="account-grid">{report.accounts.filter(row => !row.account.archived || row.value !== 0).map(row => {
        const Icon = accountIcons[row.account.kind];
        return <article className="account-card" key={row.account.id}>
          <span className="glyph" data-tone={accountTones[row.account.kind]} aria-hidden="true"><Icon size={19}/></span><div><h3>{row.account.name}</h3><p>{row.account.archived ? "Archived" : row.account.kind}</p></div><strong>{money(row.value)}</strong>
        </article>;
      })}</div> : <div className="panel"><Empty title="No accounts yet" description="Create an account in Settings to start recording entries." icon={Landmark}/></div>}
    </section>
    </div>
  </>;
}

export type Filters = { search: string; kind: string; account: string };
export function filterActivity(workspace: Workspace, month: string, filters: Filters) {
  const query = filters.search.trim().toLowerCase();
  return activity(workspace, month).filter(row =>
    (!filters.kind || row.kind === filters.kind) &&
    (!filters.account || row.accountId === filters.account || row.entry?.destination_account_id === filters.account) &&
    (!query || [row.title, row.category, accountName(workspace, row.accountId), row.entry?.notes, row.entry?.counterparty].some(value => value?.toLowerCase().includes(query))));
}
export function Transactions({ workspace, month, filters, setFilters, onOpen, onAdd }: {
  workspace: Workspace; month: string; filters: Filters; setFilters: (filters: Filters) => void;
  onOpen: (row: Activity) => void; onAdd: () => void;
}) {
  const filtered = filterActivity(workspace, month, filters);
  const groups = Map.groupBy(filtered, row => row.date);
  const filtering = !!(filters.search || filters.kind || filters.account);
  return <>
    <section className="panel filter-panel" aria-label="Transaction filters">
      <label className="search-field"><Search size={18}/><input type="search" placeholder="Search transactions" aria-label="Search transactions" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })}/></label>
      <Picker label="Filter by type" icon={ListFilter} value={filters.kind} onValueChange={kind => setFilters({ ...filters, kind })}
        options={[{ value: "", label: "All types" }, ...Object.entries(kinds).map(([value, label]) => ({ value, label })), { value: "reimbursement_receipt", label: "Reimbursement received" }]}/>
      <Picker label="Filter by account" icon={WalletCards} value={filters.account} onValueChange={account => setFilters({ ...filters, account })}
        options={[{ value: "", label: "All accounts" }, ...workspace.accounts.map(account => ({ value: account.id, label: account.name }))]}/>
    </section>
    <div className="results-line">
      <div className="result-label" aria-live="polite">{filtered.length} {filtered.length === 1 ? "entry" : "entries"} <span>·</span> {monthLabel(month)}</div>
      {filtering && <button className="button quiet" onClick={() => setFilters({ search: "", kind: "", account: "" })}>Clear filters</button>}
    </div>
    <div className="transaction-groups" key={month + "|" + filters.kind + "|" + filters.account}>
      {groups.size ? Array.from(groups, ([date, rows]) => <section key={date} className="panel date-group"><h2><CalendarDays size={15}/>{dayLabel(date)}</h2>{rows.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>)}</section>)
        : <div className="panel"><Empty title={filtering ? "No matching transactions" : "No transactions this month"}
          description={filtering ? "Try a different search or clear the filters." : "Add an entry to get this month started."}
          icon={filtering ? Search : Layers3} action={<button className="button secondary" onClick={filtering ? () => setFilters({ search: "", kind: "", account: "" }) : onAdd}>{filtering ? "Clear filters" : "Add entry"}</button>}/></div>}
    </div>
  </>;
}

const claimStatuses = ["All", "Pending", "Partial", "Settled"];

export function Reimbursements({ workspace, month, onReceive, onOpen }: {
  workspace: Workspace; month: string; onReceive: (id: string) => void; onOpen: (id: string) => void;
}) {
  const [status, setStatus] = useState("All");
  const report = monthly(workspace, month);
  const canReceive = new Set(claims(workspace).filter(claim => claim.remaining > 0).map(claim => claim.entry.id));
  const matching = report.claims.filter(claim => status === "All" || status === claim.status)
    .toSorted((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0) || b.entry.occurred_on.localeCompare(a.entry.occurred_on));
  const groups = Map.groupBy(matching, claim => claim.entry.counterparty);
  return <>
    <div className="metric-grid">
      <section className="metric panel"><div><span className="glyph" data-tone="amber"><HandCoins size={19}/></span><h2>Outstanding at month end</h2></div><strong>{money(report.receivable)}</strong><p>From current and earlier months</p></section>
      <section className="metric panel"><div><span className="glyph" data-tone="mint"><ArrowDownLeft size={19}/></span><h2>Received this month</h2></div><strong>{money(report.collected)}</strong><p>{report.receipts.length} {report.receipts.length === 1 ? "payment" : "payments"}</p></section>
      <section className="metric panel"><div><span className="glyph"><ClipboardList size={19}/></span><h2>Open claims</h2></div><strong>{report.claims.filter(claim => claim.remaining).length}</strong><p>{report.claims.filter(claim => claim.overdue).length} overdue at reporting date</p></section>
    </div>
    <div className="status-tabs segmented" style={{ "--selection": claimStatuses.indexOf(status) } as CSSProperties} role="group" aria-label="Filter reimbursements">{claimStatuses.map(label => <button key={label} aria-pressed={status === label} onClick={() => setStatus(label)}>{label}</button>)}</div>
    {!groups.size && <div className="panel"><Empty title="No matching claims" description="Mark an expense as reimbursable when you add it. Claims appear here through the selected month." icon={HandCoins}/></div>}
    {Array.from(groups, ([person, personClaims]) => <section className="claim-group" key={person}><h2>{person}</h2><div className="claim-grid">{personClaims.map(claim => <article className="panel claim-card" key={claim.entry.id}>
      <div>
        <div className="claim-top"><span className={"pill " + (claim.status === "Settled" ? "green" : claim.status === "Partial" ? "blue" : "amber")}>{claim.status}</span>{claim.overdue && <span className="pill rose">Overdue</span>}</div>
        <button className="text-link claim-title" onClick={() => onOpen(claim.entry.id)}>{claim.entry.description}<ArrowRight size={15}/></button>
        <p>{claim.entry.due_on ? "Due " + dayLabel(claim.entry.due_on) : "Recorded " + dayLabel(claim.entry.occurred_on)}</p>
      </div>
      <div>
        <div className="claim-amount"><span>Outstanding</span><strong>{money(claim.remaining)}</strong></div>
        <progress aria-label="Reimbursement progress" max={claim.entry.reimbursable_minor} value={claim.paid}/>
        <div className="claim-caption"><span>{money(claim.paid)} received</span><span>{money(claim.entry.reimbursable_minor)} claimed</span></div>
      </div>
      {(claim.receipts.length > 0 || (claim.remaining > 0 && canReceive.has(claim.entry.id))) && <div className="claim-actions">
        {claim.receipts.length > 0 && <details className="receipt-list"><summary>{claim.receipts.length} {claim.receipts.length === 1 ? "payment" : "payments"}</summary>{claim.receipts.map(receipt => <div key={receipt.id}><span>{dayLabel(receipt.received_on)} · {accountName(workspace, receipt.account_id)}</span><strong>{money(receipt.amount_minor)}</strong></div>)}</details>}
        {!!claim.remaining && canReceive.has(claim.entry.id) && <button className="button secondary" onClick={() => onReceive(claim.entry.id)}><Plus size={16}/> Receive payment</button>}
      </div>}
    </article>)}</div></section>)}
  </>;
}

export function Investments({ workspace, month, onEntry, onValue, onSettings }: {
  workspace: Workspace; month: string; onEntry: (kind: Kind, id: string) => void; onValue: (id: string) => void; onSettings: () => void;
}) {
  const report = monthly(workspace, month);
  const holdings = report.accounts.filter(row => row.account.kind === "investment");
  return <>
    <div className="metric-grid">
      <section className="metric panel"><div><span className="glyph" data-tone="orchid"><ChartSpline size={19}/></span><h2>Estimated investment value</h2></div><strong>{money(report.invested)}</strong><p>Using manual valuations and later movements</p></section>
      <section className="metric panel"><div><span className="glyph" data-tone="mint"><ArrowDownLeft size={19}/></span><h2>Contributed this month</h2></div><strong>{money(report.contribution)}</strong><p>Cash moved into investments</p></section>
      <section className="metric panel"><div><span className="glyph"><ArrowUpRight size={19}/></span><h2>Withdrawn this month</h2></div><strong>{money(report.withdrawal)}</strong><p>Cash returned from investments</p></section>
    </div>
    <SectionHeading title="Holdings"/>
    {holdings.length ? <div className="holdings-grid">{holdings.map(({ account, basis, value, valuation }) => <article className="panel investment-card" key={account.id}>
      <div className="investment-name"><span className="glyph" data-tone="orchid"><ChartSpline size={20}/></span><div><h3>{account.name}</h3><p>{account.archived ? "Archived" : valuation ? "Valued " + dayLabel(valuation.valued_on) : "Contribution balance"}</p></div></div>
      <div className="investment-estimate"><span>Estimated value</span><strong className="investment-value">{money(value)}</strong></div>
      <dl className="compact-details"><div><dt>Contributed balance</dt><dd>{money(basis)}</dd></div><div><dt>Unrealized change</dt><dd className={value > basis ? "positive" : ""}>{valuation ? (value >= basis ? "+" : "−") + money(Math.abs(value - basis)) : "—"}</dd></div></dl>
      {!account.archived && <div className="button-line"><button className="button secondary" onClick={() => onEntry("investment_contribution", account.id)}>Contribute</button><button className="button secondary" onClick={() => onEntry("investment_withdrawal", account.id)}>Withdraw</button><button className="button quiet" onClick={() => onValue(account.id)}>Update valuation</button></div>}
    </article>)}</div> : <div className="panel"><Empty title="No investment accounts yet" description="Create an investment account to track contributions and valuations." icon={ChartSpline} action={<button className="button secondary" onClick={onSettings}>Manage accounts</button>}/></div>}
  </>;
}
