"use client";

import { useState, type CSSProperties } from "react";
import { CalendarDays, Flag, Pencil, Plus, Target } from "lucide-react";
import {
  accountCurrency, activity, amountText, balances, currencyLabel, dayLabel, isCurrency, majorAmount, money, monthLabel, newId, parseDate, parseMoney, shiftMonth, today,
  type Activity, type Currency, type SavingsGoal, type Workspace,
} from "@/lib/ledger";
import { DatePicker, Picker } from "./ledger-picker";
import { TaskForm } from "./ledger-settings";
import { ActivityRow, Field, MoneyInput } from "./ledger-ui";
import { SectionHeading } from "./ledger-views";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function ActivityCalendar({ workspace, month, currency, choices, onOpen }: {
  workspace: Workspace; month: string; currency: Currency; choices?: Currency[]; onOpen: (row: Activity) => void;
}) {
  const [selected, setSelected] = useState("");
  const [preferred, setPreferred] = useState(currency);
  const unit = choices?.includes(preferred) ? preferred : currency;
  const groups = new Map<string, { rows: Activity[]; income: number; spending: number }>();
  for (const row of activity(workspace, month, unit)) {
    const day = groups.get(row.date) ?? { rows: [], income: 0, spending: 0 };
    day.rows.push(row);
    if (row.kind === "income") day.income += row.amount;
    if (row.kind === "expense") day.spending -= row.amount;
    groups.set(row.date, day);
  }
  const first = new Date(month + "-01T00:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.parse(shiftMonth(month, 1) + "-01T00:00:00Z") - 86_400_000).getUTCDate();
  const current = today();
  const day = selected.startsWith(month) ? selected : current.startsWith(month) ? current : month + "-01";
  const compactAmount = (amount: number) => compact.format(majorAmount(amount, unit));
  return <section className="panel calendar-panel">
    <SectionHeading title="Activity calendar" subtitle={monthLabel(month) + " · " + unit}
      action={choices && choices.length > 1 ? <Picker label="Calendar currency" value={unit}
        options={choices.map(code => ({ value: code, label: code }))} onValueChange={code => { if (isCurrency(code)) setPreferred(code); }}/> : undefined}/>
    <div className="activity-calendar" aria-label={monthLabel(month)}>
      {weekdays.map(label => <span className="calendar-weekday" key={label} aria-hidden="true">{label}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={"blank" + index} aria-hidden="true"/>)}
      {Array.from({ length: days }, (_, index) => {
        const date = month + "-" + String(index + 1).padStart(2, "0");
        const record = groups.get(date);
        const { income = 0, spending = 0 } = record ?? {};
        return <button key={date} type="button" className="calendar-day" data-activity={spending ? "spending" : income ? "income" : record ? "other" : undefined} aria-pressed={date === day}
          aria-current={date === current ? "date" : undefined}
          aria-label={dayLabel(date) + (record ? `, ${record.rows.length} ${record.rows.length === 1 ? "entry" : "entries"}, income ${money(income, unit)}, spending ${money(spending, unit)}` : ", no entries")}
          onClick={() => setSelected(date)}>
          <span>{index + 1}</span>
          <small aria-hidden="true">{income > 0 && <b className="calendar-income">+{compactAmount(income)}</b>}{spending > 0 && <b className="calendar-spending">−{compactAmount(spending)}</b>}{record && !income && !spending && "•"}</small>
        </button>;
      })}
    </div>
    <div className="calendar-detail" aria-live="polite">
      <h3><CalendarDays size={17} aria-hidden="true"/>{dayLabel(day)}</h3>
      {groups.get(day)?.rows.map(row => <ActivityRow key={row.id} row={row} workspace={workspace} onOpen={onOpen}/>) ?? <p>No entries on this date.</p>}
    </div>
  </section>;
}

export function SavingsGoals({ workspace, currencies, onAdd, onEdit }: {
  workspace: Workspace; currencies: Currency[]; onAdd?: () => void; onEdit: (goal: SavingsGoal) => void;
}) {
  const goals = workspace.savings_goals.filter(goal => currencies.includes(goal.currency));
  const nextDay = new Date(Date.parse(today() + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const cash = balances(workspace, nextDay).filter(row => row.account.kind !== "investment");
  return <section className="panel goals-panel">
    <SectionHeading title="Savings goals" subtitle="Set money aside without moving it between accounts."
      action={onAdd && <button type="button" className="button secondary" onClick={onAdd}><Plus size={17}/> Add goal</button>}/>
    <div className="reserve-grid">{currencies.map(currency => {
      const totalCash = cash.filter(row => accountCurrency(row.account) === currency).reduce((sum, row) => sum + row.value, 0);
      const reserved = goals.filter(goal => goal.currency === currency).reduce((sum, row) => sum + row.reserved_minor, 0);
      return <dl key={currency} className="reserve-summary">
        <div><dt>{currency} cash today</dt><dd>{money(totalCash, currency)}</dd></div>
        <div><dt>Set aside</dt><dd>{money(reserved, currency)}</dd></div>
        <div><dt>{totalCash < reserved ? "Cash shortfall" : "Available to spend"}</dt><dd>{money(Math.abs(totalCash - reserved), currency)}</dd></div>
      </dl>;
    })}</div>
    {goals.length ? <div className="goal-grid">{goals.map(goal => {
      const ratio = Math.round(goal.reserved_minor / goal.target_minor * 100);
      return <button className="goal-card" type="button" key={goal.id} onClick={() => onEdit(goal)} aria-label={`Edit ${goal.name}, ${ratio}% funded`}>
        <span className="glyph" data-tone="amber"><Flag size={18} aria-hidden="true"/></span>
        <span className="goal-title"><strong>{goal.name}</strong><small>{goal.target_on ? dayLabel(goal.target_on) : "No target date"}</small></span>
        <Pencil size={15} aria-hidden="true"/>
        <span className="goal-ring" style={{ "--goal-progress": Math.min(100, ratio) + "%" } as CSSProperties}>{ratio > 100 ? "100%+" : ratio + "%"}</span>
        <span className="goal-amount"><strong>{money(goal.reserved_minor, goal.currency)}</strong><small>of {money(goal.target_minor, goal.currency)}</small></span>
      </button>;
    })}</div> : <p className="goal-empty"><Target size={18} aria-hidden="true"/> {onAdd ? "Add a goal to start setting money aside." : "Open a sheet with a cash account to add a goal."}</p>}
  </section>;
}

export function GoalDialog({ goal, sheetId, currencies, preferred, close, onSave, onDelete }: {
  goal?: SavingsGoal; sheetId: string; currencies: Currency[]; preferred: Currency; close: () => void;
  onSave: (goal: SavingsGoal) => Promise<void>; onDelete: (goal: SavingsGoal) => void;
}) {
  const [id] = useState(newId);
  const [currency, setCurrency] = useState(goal?.currency ?? (currencies.includes(preferred) ? preferred : currencies[0]));
  return <TaskForm title={goal ? "Edit savings goal" : "Add savings goal"} close={close} label={goal ? "Save goal" : "Create goal"} submit={async data => {
    const name = String(data.get("name") ?? "").trim();
    const target = parseMoney(String(data.get("target") ?? ""), currency);
    const reserved = parseMoney(String(data.get("reserved") || "0"), currency);
    const deadline = String(data.get("deadline") ?? "");
    const date = deadline ? parseDate(deadline) : null;
    if (!name || name.length > 70 || !target || reserved === null || deadline && !date) throw Error("Enter a name, a positive target, and a valid amount to set aside.");
    await onSave({ id: goal?.id ?? id, ledger_id: goal ? goal.ledger_id ?? null : sheetId || null, name, currency, target_minor: target, reserved_minor: reserved, target_on: date });
  }}>
    <Field label="Goal name" full><input name="name" defaultValue={goal?.name} placeholder="e.g. Emergency fund" maxLength={70} required/></Field>
    <Field label="Currency"><Picker label="Goal currency" value={currency} disabled={!!goal}
      options={currencies.map(code => ({ value: code, label: code }))} onValueChange={code => { if (isCurrency(code)) setCurrency(code); }}/></Field>
    <Field label="Target date (optional)"><DatePicker label="Target date" name="deadline" defaultValue={goal?.target_on ?? ""}/></Field>
    <Field label={`Target (${currencyLabel(currency)})`}><MoneyInput key={"target-" + currency} currency={currency} name="target" defaultValue={goal ? amountText(goal.target_minor, currency) : ""} required/></Field>
    <Field label={`Set aside (${currencyLabel(currency)})`} hint="You can change this amount any time."><MoneyInput key={"reserve-" + currency} currency={currency} name="reserved" defaultValue={goal ? amountText(goal.reserved_minor, currency) : ""}/></Field>
    {goal && <button type="button" className="button danger quiet" onClick={() => onDelete(goal)}>Remove goal</button>}
  </TaskForm>;
}
