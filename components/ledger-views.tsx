"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, BanknoteArrowDown, BanknoteArrowUp, CalendarDays, ChartNoAxesCombined, ChartPie,
  Check, ChevronDown, FileClock, HandCoins, Layers3, ListFilter, Plus, Search, ShoppingBag, TicketCheck, Users, WalletCards, type LucideIcon,
} from "lucide-react";
import {
  accountCurrency, accountName, activity, claims, dayLabel, kinds, majorAmount, money, inPeriod, monthLabel, overviewHistory, paymentKey, periodLabel, periodReport, reimbursementReport, shiftMonth, today, workspaceForBook,
  type Activity, type Currency, type Kind, type Receipt, type Workspace,
} from "@/lib/ledger";
import { accountIcons, accountTones, ActivityRow, Empty, palette } from "./ledger-ui";
import { Picker } from "./ledger-picker";

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function CombinedOverview({ workspace, period, currencies, allSheets, onOpenSheet }: {
  workspace: Workspace; period: string; currencies: Currency[]; allSheets: boolean; onOpenSheet: (id: string) => void;
}) {
  const sheets = [{ id: "", name: "Personal" }, ...workspace.finance_books];
  const [preferredChartCurrency, setPreferredChartCurrency] = useState<Currency | undefined>();
  const chartCurrency = preferredChartCurrency && currencies.includes(preferredChartCurrency) ? preferredChartCurrency : currencies[0];
  return <div className="combined-overview">
    <SectionHeading title={allSheets ? "All sheets at a glance" : "Balances by currency"} subtitle={`${periodLabel(period)} · Each currency has its own totals`}/>
    <div className="combined-grid">{currencies.map(currency => {
      const report = periodReport(workspace, period, currency);
      return <section className="panel combined-card" key={currency}>
        <h2>{currency}</h2><p>Cash balance</p><strong>{money(report.cash, currency)}</strong>
        <dl className="compact-details">{([["Income", report.income], ["Spending", report.spending], ["Owed to you", report.receivable], ["Investments", report.invested]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value, currency)}</dd></div>)}</dl>
        <div className="combined-accounts"><h3>Cash by account</h3>
          <AccountBalances accounts={report.accounts.filter(row => row.account.kind !== "investment")} currency={currency}
            sheetName={allSheets ? id => sheets.find(sheet => sheet.id === (id ?? ""))?.name : undefined}/>
        </div>
      </section>;
    })}</div>
    {chartCurrency && <OverviewTrends workspace={workspace} period={period} currency={chartCurrency}
      currencyPicker={currencies.length > 1 && <Picker label="Chart currency" value={chartCurrency}
        options={currencies.map(code => ({ value: code, label: code }))}
        onValueChange={value => setPreferredChartCurrency(currencies.find(code => code === value))}/>}/>}
    {allSheets && <section className="panel combined-sheets"><SectionHeading title="Finance sheets" subtitle="Open a sheet to see its detailed reports and entries"/>
      {sheets.map(sheet => {
        const scope = workspaceForBook(workspace, sheet.id);
        const codes = currencies.filter(currency => scope.accounts.some(account => accountCurrency(account) === currency));
        return <button type="button" className="combined-sheet-row" key={sheet.id} onClick={() => onOpenSheet(sheet.id)}>
          <strong>{sheet.name}</strong><span>{codes.length ? codes.map(code => money(periodReport(scope, period, code).cash, code)).join(" · ") : "No balances for this view"}</span><ArrowRight size={16} aria-hidden="true"/>
        </button>;
      })}
    </section>}
  </div>;
}

function MovementChart({ workspace, period, currency }: { workspace: Workspace; period: string; currency: Currency }) {
  const [range, setRange] = useState(3);
  const yearBuckets = period === "all";
  const monthlyView = period.length === 7;
  const periods = yearBuckets
    ? [...new Set([today().slice(0, 4), ...workspace.transactions.map(row => row.occurred_on.slice(0, 4)),
      ...workspace.reimbursement_receipts.map(row => row.received_on.slice(0, 4))])].sort().slice(-6)
    : monthlyView ? Array.from({ length: range }, (_, index) => shiftMonth(period, index - range + 1))
      : Array.from({ length: 12 }, (_, index) => shiftMonth(period + "-01", index));
  const series = periods.map(bucket => ({ period: bucket, ...periodReport(workspace, bucket, currency) }));
  return <section className="flow-panel">
    <SectionHeading title="Cash movement" subtitle={yearBuckets ? "Up to six most recent years" : undefined} action={monthlyView && <div className="range-switch segmented" style={{ "--selection": range === 3 ? 0 : 1 } as CSSProperties} role="group" aria-label="Cash movement range">
      {[3, 6].map(count => <button type="button" key={count} aria-label={count + " months"} aria-pressed={range === count} onClick={() => setRange(count)}>{count}M</button>)}
    </div>}/>
    <BarComparison series={series.map(row => ({ period: row.period, first: row.cashIn, second: row.cashOut }))}
      currency={currency} labels={["Inflow", "Outflow"]} selected={monthlyView ? period : undefined} yearBuckets={yearBuckets}/>
  </section>;
}

function BarComparison({ series, currency, labels, selected, yearBuckets }: {
  series: { period: string; first: number; second: number }[]; currency: Currency; labels: [string, string]; selected?: string; yearBuckets?: boolean;
}) {
  const format = (amount: number) => money(amount, currency);
  const max = Math.max(...series.map(item => Math.max(item.first, item.second)), 100);
  const exponent = 10 ** Math.floor(Math.log10(max));
  const scale = Math.ceil(max / exponent * 2) * exponent / 2;
  const axis = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  return <>
    <div className="chart-legend"><span><i className="income-key"/> {labels[0]}</span><span><i className="expense-key"/> {labels[1]}</span><span className="chart-unit">{currency}</span></div>
    <div className={"chart" + (series.length > 6 ? " chart-dense" : "")} role="img" aria-label={series.map(row => periodLabel(row.period) + " " + labels[0] + " " + format(row.first) + ", " + labels[1] + " " + format(row.second)).join(". ")}>
      <div className="chart-ticks" aria-hidden="true">{[1, .75, .5, .25, 0].map(ratio => <span key={ratio}>{axis.format(majorAmount(scale * ratio, currency))}</span>)}</div>
      <div className="chart-body" aria-hidden="true">
        <div className="chart-lines"><i/><i/><i/><i/><i/></div>
        <div className="chart-groups" style={{ gridTemplateColumns: "repeat(" + series.length + ", minmax(0, 1fr))" }}>{series.map((row, index) => <div key={row.period} style={{ "--step": index } as CSSProperties} className={"chart-group" + (!selected || row.period === selected ? " current" : "")}>
          <div className="chart-bars">
            <div className="chart-tip"><strong>{periodLabel(row.period)}</strong><span>{labels[0]} {format(row.first)}</span><span>{labels[1]} {format(row.second)}</span></div>
            <i className="income-key" hidden={!row.first} style={{ height: (row.first / scale * 100) + "%" }}/><i className="expense-key" hidden={!row.second} style={{ height: (row.second / scale * 100) + "%" }}/>
          </div>
          <span>{yearBuckets ? row.period : monthLabel(row.period).slice(0, 3)}</span>
        </div>)}</div>
      </div>
    </div>
    <details className="chart-details">
      <summary>{yearBuckets ? "Yearly totals" : "Monthly totals"}</summary>
      <dl>{series.toReversed().map(row => <div key={row.period}>
        <dt>{periodLabel(row.period)}</dt><dd>{labels[0]} {format(row.first)}<br/>{labels[1]} {format(row.second)}</dd>
      </div>)}</dl>
    </details>
  </>;
}

function OverviewTrends({ workspace, period, currency, currencyPicker }: {
  workspace: Workspace; period: string; currency: Currency; currencyPicker?: ReactNode;
}) {
  const series = overviewHistory(workspace, period, currency);
  const current = series.at(-1);
  const format = (amount: number) => money(amount, currency);
  const axis = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const low = Math.min(0, ...series.map(row => row.wealth));
  const high = Math.max(0, ...series.map(row => row.wealth));
  const spread = Math.max(high - low, 100);
  const unit = 10 ** Math.floor(Math.log10(spread / 4));
  const step = Math.ceil(spread / 4 / unit) * unit;
  const bottom = Math.floor(low / step) * step;
  const top = Math.max(bottom + step, Math.ceil(high / step) * step);
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, index) => top - index * step);
  const points = series.map((row, index) => ({
    x: (index + .5) / series.length * 480, y: 5 + (top - row.wealth) / (top - bottom) * 146,
  }));
  return <section className="overview-trends" aria-label="Monthly trends">
    {currencyPicker && <div className="overview-trend-toolbar">{currencyPicker}</div>}
    <div className="overview-trend-grid">
      <section className="panel trend-card" data-tone="blue">
        <SectionHeading title="Net wealth" subtitle={"Cash + investments + owed to you · " + currency}/>
        {current && <div className="trend-value"><strong>{format(current.wealth)}</strong><span>{periodLabel(current.month)}</span></div>}
        <div className="chart wealth-chart" role="img" aria-label={series.map(row => periodLabel(row.month) + " " + format(row.wealth)).join(". ")}>
          <div className="chart-ticks" aria-hidden="true">{ticks.map(tick => <span key={tick}>{axis.format(majorAmount(tick, currency))}</span>)}</div>
          <div className="chart-body" aria-hidden="true">
            <div className="chart-lines">{ticks.map(tick => <i key={tick}/>)}</div>
            <svg className="wealth-plot" viewBox="0 0 480 156" preserveAspectRatio="none">
              <polyline points={points.map(point => point.x + "," + point.y).join(" ")} vectorEffect="non-scaling-stroke"/>
              {points.map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3" vectorEffect="non-scaling-stroke"/>)}
            </svg>
            <div className={"chart-groups" + (series.length > 6 ? " chart-dense" : "")} style={{ gridTemplateColumns: "repeat(" + series.length + ", minmax(0, 1fr))" }}>
              {series.map(row => <div className="chart-group" key={row.month}><span>{monthLabel(row.month).slice(0, 3)}</span></div>)}
            </div>
          </div>
        </div>
        <details className="chart-details"><summary>Monthly balances</summary>
          <dl>{series.toReversed().map(row => <div key={row.month}><dt>{periodLabel(row.month)}</dt><dd>{format(row.wealth)}</dd></div>)}</dl>
        </details>
      </section>
      <section className="panel trend-card" data-tone="mint">
        <SectionHeading title="Monthly income and expenses" subtitle="Expenses before reimbursements"/>
        <BarComparison series={series.map(row => ({ period: row.month, first: row.income, second: row.expenses }))}
          currency={currency} labels={["Income", "Expenses"]}/>
      </section>
    </div>
  </section>;
}

function AccountBalances({ accounts, currency, sheetName }: {
  accounts: ReturnType<typeof periodReport>["accounts"]; currency: Currency; sheetName?: (id: string | null | undefined) => string | undefined;
}) {
  const visible = accounts.filter(row => !row.account.archived || row.value !== 0);
  if (!visible.length) return <p className="muted">No accounts in this view.</p>;
  return <div className="account-grid">{visible.map(row => {
    const Icon = accountIcons[row.account.kind];
    const detail = [sheetName?.(row.account.ledger_id), row.account.archived ? "Archived" : row.account.kind].filter(Boolean).join(" · ");
    return <article className="account-card" key={row.account.id}>
      <span className="glyph" data-tone={accountTones[row.account.kind]} aria-hidden="true"><Icon size={19}/></span>
      <div><h3>{row.account.name}</h3><p>{detail}</p></div><strong>{money(row.value, currency)}</strong>
    </article>;
  })}</div>;
}

function Metric({ title, value, hint, tone, icon: Icon, period }: {
  title: string; value: string | number; hint: string; tone: string; icon: LucideIcon; period: string;
}) {
  return <section className="metric" data-tone={tone}>
    <div><span className="glyph" data-tone={tone} aria-hidden="true"><Icon size={19}/></span><h2>{title}</h2></div>
    <strong key={period}>{value}</strong><p>{hint}</p>
  </section>;
}

export function Overview({ workspace, period, currency, onBrowse, onOpen, onAdd }: {
  workspace: Workspace; period: string; currency: Currency; onBrowse: () => void; onOpen: (row: Activity) => void; onAdd: () => void;
}) {
  const format = (amount: number) => money(amount, currency);
  const report = periodReport(workspace, period, currency);
  const recent = activity(workspace, period, currency).slice(0, 5);
  const priorPeriod = period === "all" ? null : period.length === 4 ? String(Number(period) - 1) : shiftMonth(period, -1);
  const prior = priorPeriod ? periodReport(workspace, priorPeriod, currency) : null;
  const change = report.netCashFlow - (prior?.netCashFlow ?? 0);
  const metrics = [
    { name: "Income", amount: report.income, hint: "Income earned this period", icon: BanknoteArrowDown, tone: "mint" },
    { name: "Personal spending", amount: report.spending, hint: format(report.gross) + " paid before claims", icon: ShoppingBag, tone: "coral" },
    { name: "Owed to you", amount: report.receivable, hint: report.claims.filter(claim => claim.remaining).length + " open claims at period end", icon: HandCoins, tone: "amber" },
  ];
  return <>
    <div className="overview-grid">
      <section className="panel cash-report" aria-label="Cash balance and movement">
        <div className="balance-header">
          <div className="balance-main">
            <span className="balance-label">Cash balance</span>
            <strong key={period + report.cash}>{format(report.cash)}</strong>
            <p>{period === "all" ? "Across recorded history" : "At the end of " + periodLabel(period)}</p>
          </div>
          <div className="balance-delta" data-tone={report.netCashFlow > 0 ? "mint" : report.netCashFlow < 0 ? "coral" : "blue"}>
            <span>Net cash flow</span>
            <strong key={period + report.netCashFlow}>{report.netCashFlow > 0 ? "+" : report.netCashFlow < 0 ? "−" : ""}{format(Math.abs(report.netCashFlow))}</strong>
            {!!(prior?.cashIn || prior?.cashOut) && <small>{change > 0 ? <ArrowUpRight size={14}/> : change < 0 ? <ArrowDownLeft size={14}/> : null}
              {change ? format(Math.abs(change)) + (change > 0 ? " higher" : " lower") + " than prior period" : "Same as prior period"}</small>}
          </div>
        </div>
        <MovementChart workspace={workspace} period={period} currency={currency}/>
      </section>
      <div className="overview-side">
        <section className="panel month-summary">
          <SectionHeading title="Period summary"/>
          <dl>{metrics.map(({ name, amount, hint, icon: Icon, tone }) => <div className="summary-row" data-tone={tone} key={name}>
            <dt><span className="glyph" data-tone={tone} aria-hidden="true"><Icon size={17}/></span><span>{name}<small>{hint}</small></span></dt>
            <dd key={period}>{format(amount)}</dd>
          </div>)}</dl>
        </section>
      <section className="panel spending-panel">
        <SectionHeading title="Spending breakdown" subtitle="Excludes amounts owed to you"/>
        {report.categories.length ? <ul className="category-bars">{report.categories.map((row, index) => <li key={row.id ?? "uncategorized"}>
          <div><span><i className={"category-dot " + (workspace.categories.find(category => category.id === row.id)?.color ?? palette[index % palette.length])}/>{row.name}</span><strong>{format(row.amount)}</strong></div>
          <div className="bar-track" aria-hidden="true"><i className={workspace.categories.find(category => category.id === row.id)?.color ?? palette[index % palette.length]} style={{ width: (row.amount / report.spending * 100) + "%" }}/></div>
        </li>)}</ul> : <Empty title="No spending yet" description="Expenses for this period will appear here." icon={ChartPie}/>}
      </section>
      </div>
    </div>
    <div className="overview-lower">
    <section className="panel recent-panel">
      <SectionHeading title="Recent activity" action={<button className="button quiet" type="button" onClick={onBrowse}>View all <ArrowRight size={15}/></button>}/>
      {recent.length ? <div className="activity-list">{recent.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>)}</div>
        : <Empty title="No activity this period" description="Add an entry to start building this period’s record." action={<button type="button" className="button secondary" onClick={onAdd}><Plus size={16}/> Add entry</button>}/>}
    </section>
    <section className="panel account-section">
      <SectionHeading title="Cash by account" subtitle="Balances at the reporting date"/>
      <AccountBalances accounts={report.accounts.filter(row => row.account.kind !== "investment")} currency={currency}/>
      {report.accounts.some(row => row.account.kind === "investment" && (!row.account.archived || row.value !== 0)) && <>
        <h3 className="overview-investment-label">Investment accounts</h3>
        <AccountBalances accounts={report.accounts.filter(row => row.account.kind === "investment")} currency={currency}/>
      </>}
    </section>
    </div>
    <OverviewTrends workspace={workspace} period={period} currency={currency}/>
  </>;
}

export type Filters = { search: string; kind: string; account: string };
export function filterActivity(workspace: Workspace, period: string, filters: Filters, currency: Currency) {
  const query = filters.search.trim().toLowerCase();
  return activity(workspace, period, currency).filter(row =>
    (!filters.kind || row.kind === filters.kind || filters.kind === "balance_update" && row.balanceUpdate) &&
    (!filters.account || row.accountId === filters.account || row.entry?.destination_account_id === filters.account) &&
    (!query || [row.title, row.category, accountName(workspace, row.accountId), row.entry?.notes, row.entry?.counterparty].some(value => value?.toLowerCase().includes(query))));
}
export function Transactions({ workspace, period, currency, filters, setFilters, onOpen, onAdd }: {
  workspace: Workspace; period: string; currency: Currency; filters: Filters; setFilters: (filters: Filters) => void;
  onOpen: (row: Activity) => void; onAdd: () => void;
}) {
  const filtered = filterActivity(workspace, period, filters, currency);
  const groups = Map.groupBy(filtered, row => row.date);
  const filtering = !!(filters.search || filters.kind || filters.account);
  return <>
    <section className="panel filter-panel" aria-label="Transaction filters">
      <label className="search-field"><Search size={18}/><input type="search" placeholder="Search transactions" aria-label="Search transactions" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })}/></label>
      <Picker label="Filter by type" icon={ListFilter} value={filters.kind} onValueChange={kind => setFilters({ ...filters, kind })}
        options={[{ value: "", label: "All types" }, ...Object.entries(kinds).map(([value, label]) => ({ value, label })),
          { value: "reimbursement_receipt", label: "Reimbursement received" }, { value: "balance_update", label: "Balance updates" }]}/>
      <Picker label="Filter by account" icon={WalletCards} value={filters.account} onValueChange={account => setFilters({ ...filters, account })}
        options={[{ value: "", label: "All accounts" }, ...workspace.accounts.map(account => ({ value: account.id, label: account.name }))]}/>
    </section>
    <div className="results-line">
      <div className="result-label" aria-live="polite">{filtered.length} {filtered.length === 1 ? "entry" : "entries"} <span>·</span> {periodLabel(period)}</div>
      {filtering && <button className="button quiet" onClick={() => setFilters({ search: "", kind: "", account: "" })}>Clear filters</button>}
    </div>
    <div className="transaction-groups" key={period + "|" + filters.kind + "|" + filters.account}>
      {groups.size ? Array.from(groups, ([date, rows]) => <section key={date} className="panel date-group"><h2><CalendarDays size={15}/>{dayLabel(date)}</h2>{rows.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>)}</section>)
        : <div className="panel"><Empty title={filtering ? "No matching transactions" : "No transactions this period"}
          description={filtering ? "Try a different search or clear the filters." : "Add an entry to get this period started."}
          icon={filtering ? Search : Layers3} action={<button className="button secondary" onClick={filtering ? () => setFilters({ search: "", kind: "", account: "" }) : onAdd}>{filtering ? "Clear filters" : "Add entry"}</button>}/></div>}
    </div>
  </>;
}

const claimStatuses = ["All", "Pending", "Partial", "Settled"];

function ReimbursementPeople({ people, selected, onChange }: { people: string[]; selected: string[]; onChange: (people: string[]) => void }) {
  const options = [...new Set([...people, ...selected])].sort((a, b) => a.localeCompare(b));
  const label = selected.length > 1 ? selected.length + " people selected" : selected[0] ?? "All people";
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger type="button" className="picker-trigger person-filter" aria-label={"Filter by person, " + label} disabled={!options.length}>
      <Users size={17} className="picker-leading" aria-hidden="true"/><span className="picker-value">{label}</span>
      <ChevronDown size={15} className="picker-chevron" aria-hidden="true"/>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="picker-menu person-menu" aria-label="Filter reimbursements by person" align="start" sideOffset={7} collisionPadding={12}>
        <DropdownMenu.CheckboxItem className="picker-option" checked={!selected.length} data-selected={!selected.length || undefined}
          onSelect={() => onChange([])}>
          All people<DropdownMenu.ItemIndicator className="picker-check"><Check size={15} aria-hidden="true"/></DropdownMenu.ItemIndicator>
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.Separator className="person-menu-divider"/>
        <DropdownMenu.Group className="picker-options" aria-label="People">
          {options.map(person => {
            const checked = selected.includes(person);
            return <DropdownMenu.CheckboxItem key={person} className="picker-option" checked={checked} data-selected={checked || undefined} textValue={person}
              onSelect={event => event.preventDefault()}
              onCheckedChange={next => onChange(next ? [...selected, person] : selected.filter(name => name !== person))}>
              <span>{person}</span><DropdownMenu.ItemIndicator className="picker-check"><Check size={15} aria-hidden="true"/></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>;
          })}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export function Reimbursements({ workspace, period, currency, selectedPeople, onPeopleChange, onReceive, onOpen, onPayment }: {
  workspace: Workspace; period: string; currency: Currency; onReceive: (id: string) => void; onOpen: (id: string) => void; onPayment: (receipt: Receipt) => void;
  selectedPeople: string[]; onPeopleChange: (people: string[]) => void;
}) {
  const format = (amount: number) => money(amount, currency);
  const [status, setStatus] = useState("All");
  const report = reimbursementReport(workspace, period, selectedPeople);
  const paymentCount = new Set(report.receipts.map(paymentKey)).size;
  const canReceive = new Set(claims(workspace).filter(claim => claim.remaining > 0 && claim.entry.occurred_on <= today()).map(claim => claim.key));
  const matching = report.claims.filter(claim => status === "All" || status === claim.status)
    .toSorted((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0) || b.entry.occurred_on.localeCompare(a.entry.occurred_on));
  const groups = Map.groupBy(matching, claim => claim.counterparty);
  return <>
    <div className="metric-grid">
      <Metric title="Outstanding at period end" value={format(report.outstanding)} hint="Includes earlier unpaid claims" tone="amber" icon={HandCoins} period={period}/>
      <Metric title="Received this period" value={format(report.collected)} hint={paymentCount + (paymentCount === 1 ? " payment" : " payments")} tone="mint" icon={TicketCheck} period={period}/>
      <Metric title="Open claims" value={report.claims.filter(claim => claim.remaining).length} hint={report.claims.filter(claim => claim.overdue).length + " overdue at reporting date"} tone="orchid" icon={FileClock} period={period}/>
    </div>
    <div className="claim-filters">
      <ReimbursementPeople people={report.people} selected={selectedPeople} onChange={onPeopleChange}/>
      <div className="status-tabs segmented" style={{ "--selection": claimStatuses.indexOf(status) } as CSSProperties} role="group" aria-label="Filter by status">{claimStatuses.map(label => <button key={label} aria-pressed={status === label} onClick={() => setStatus(label)}>{label}</button>)}</div>
      <small className="muted">PDF uses the people selected here.</small>
    </div>
    {!groups.size && <div className="panel"><Empty title="No matching claims"
      description={selectedPeople.length || status !== "All" ? "Choose other people or clear the filters to see more claims." : "Reimbursable expenses, payments, and earlier outstanding claims appear here."}
      action={selectedPeople.length || status !== "All" ? <button className="button secondary" onClick={() => { onPeopleChange([]); setStatus("All"); }}>Clear filters</button> : undefined}
      icon={HandCoins}/></div>}
    {Array.from(groups, ([person, personClaims]) => <section className="claim-group" key={person}><h2>{person}</h2><div className="claim-grid">{personClaims.map(claim => <article className="panel claim-card" key={claim.key}>
      <div>
        <div className="claim-top"><span className={"pill " + (claim.status === "Settled" ? "green" : claim.status === "Partial" ? "blue" : "amber")}>{claim.status}</span>{claim.overdue && <span className="pill rose">Overdue</span>}</div>
        <button className="text-link claim-title" onClick={() => onOpen(claim.entry.id)}>{claim.entry.description}<ArrowRight size={15}/></button>
        <p>{claim.due_on ? "Due " + dayLabel(claim.due_on) : "Recorded " + dayLabel(claim.entry.occurred_on)}</p>
      </div>
      <div>
        <div className="claim-amount"><span>Outstanding</span><strong>{format(claim.remaining)}</strong></div>
        <progress aria-label="Reimbursement progress" max={claim.amount_minor} value={claim.paid}/>
        <div className="claim-caption"><span>{format(claim.paid)} received</span><span>{format(claim.amount_minor)} claimed</span></div>
      </div>
      {(claim.receipts.length > 0 || (claim.remaining > 0 && canReceive.has(claim.key))) && <div className="claim-actions">
        {claim.receipts.length > 0 && <details className="receipt-list"><summary>{claim.receipts.length} {claim.receipts.length === 1 ? "payment" : "payments"}</summary>{claim.receipts.map(receipt => <button type="button" key={receipt.id} onClick={() => onPayment(receipt)}>
          <span>{dayLabel(receipt.received_on)} · {accountName(workspace, receipt.account_id)}</span><strong>{format(receipt.amount_minor)}</strong><ArrowRight size={14} aria-hidden="true"/>
        </button>)}</details>}
        {!!claim.remaining && canReceive.has(claim.key) && <button className="button secondary" onClick={() => onReceive(claim.key)}><Plus size={16}/> Receive payment</button>}
      </div>}
    </article>)}</div></section>)}
  </>;
}

export function Investments({ workspace, period, currency, onEntry, onValue, onBalance, onOpen, onSettings }: {
  workspace: Workspace; period: string; currency: Currency; onEntry: (kind: Kind, id: string) => void; onValue: (id: string) => void; onSettings: () => void;
  onBalance: (id: string) => void; onOpen: (row: Activity) => void;
}) {
  const format = (amount: number) => money(amount, currency);
  const report = periodReport(workspace, period, currency);
  const holdings = report.accounts.filter(row => row.account.kind === "investment");
  const updates = activity(workspace, period, currency).filter(row => row.kind === "balance_update" &&
    holdings.some(holding => holding.account.id === row.accountId));
  return <>
    <div className="metric-grid">
      <Metric title="Estimated investment value" value={format(report.invested)} hint="Using recorded values and later movements" tone="orchid" icon={ChartNoAxesCombined} period={period}/>
      <Metric title="Contributed this period" value={format(report.contribution)} hint="Cash moved into investments" tone="mint" icon={BanknoteArrowUp} period={period}/>
      <Metric title="Withdrawn this period" value={format(report.withdrawal)} hint="Cash returned from investments" tone="blue" icon={BanknoteArrowDown} period={period}/>
    </div>
    <SectionHeading title="Holdings"/>
    {holdings.length ? <div className="holdings-grid">{holdings.map(({ account, basis, value, valuation }) => <article className="panel investment-card" key={account.id}>
      <div className="investment-name"><span className="glyph" data-tone="orchid" aria-hidden="true"><ChartNoAxesCombined size={20}/></span><div><h3>{account.name}</h3><p>{account.archived ? "Archived" : valuation ? "Valued " + dayLabel(valuation.valued_on) : "Contribution balance"}</p></div></div>
      <div className="investment-estimate"><span>Estimated value</span><strong className="investment-value">{format(value)}</strong></div>
      <dl className="compact-details"><div><dt>Contributed balance</dt><dd>{format(basis)}</dd></div><div><dt>Unrealized change</dt><dd className={value > basis ? "positive" : ""}>{valuation ? (value >= basis ? "+" : "−") + format(Math.abs(value - basis)) : "—"}</dd></div></dl>
      {!account.archived && <div className="button-line"><button className="button secondary" onClick={() => onEntry("investment_contribution", account.id)}>Contribute</button><button className="button secondary" onClick={() => onEntry("investment_withdrawal", account.id)}>Withdraw</button>
        {account.opening_date <= today() && <button className="button secondary" onClick={() => onBalance(account.id)}>Record balance</button>}
        <button className="button quiet" onClick={() => onValue(account.id)}>Update valuation</button></div>}
    </article>)}</div> : <div className="panel"><Empty title="No investment accounts yet" description="Create an investment account to track contributions and valuations." icon={ChartNoAxesCombined} action={<button className="button secondary" onClick={onSettings}>Manage accounts</button>}/></div>}
    {!!updates.length && <section className="panel date-group"><h2>Investment balance updates</h2>
      {updates.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>)}</section>}
  </>;
}
