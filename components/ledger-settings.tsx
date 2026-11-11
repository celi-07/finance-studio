"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Download, HandCoins, Pencil, Plus, RotateCcw, X } from "lucide-react";
import {
  accountCurrency, accountName, activeFields, amountExample, amountText, balanceBeforeUpdate, balanceUpdateTitle, claims, currencies, currencyForAccount, currencyLabel, dayLabel, formatMoneyInput, isCurrency, money, newId, parseDate, parseMoney, signed, today,
  type Account, type BalanceUpdate, type Category, type Collection, type Currency, type Field as Definition, type FieldType, type FinanceBook, type Receipt, type ReimbursementPerson, type Valuation, type Workspace,
} from "@/lib/ledger";
import { accountIcons, accountTones, Field, Modal, MoneyInput, palette } from "./ledger-ui";
import { DatePicker, Picker } from "./ledger-picker";
import { SectionHeading } from "./ledger-views";

type Save = <K extends Collection>(collection: K, rows: Workspace[K]) => Promise<void>;
export type Management = { collection: "accounts"; row?: Account } | { collection: "categories"; row?: Category } | { collection: "field_definitions"; row?: Definition }
  | { collection: "reimbursement_people"; row?: ReimbursementPerson };
const kindLabels = { bank: "Bank account", wallet: "E-wallet", cash: "Cash on hand", investment: "Investment account" };
const currencyOptions = Object.entries(currencies).map(([value, label]) => ({ value, label: value + " · " + label }));
const typeLabels: Record<FieldType, string> = { text: "Text", number: "Number", date: "Date", select: "Select", checkbox: "Checkbox" };

export function TaskForm({ title, subtitle, close, submit, label, children, disabled, destructive }: {
  title: string; subtitle?: string; close: () => void; submit: (data: FormData) => Promise<void>; label: string; children?: ReactNode; disabled?: boolean; destructive?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || disabled) return;
    const data = new FormData(event.currentTarget);
    setError(""); setWorking(true);
    try { await submit(data); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That change could not be saved."); }
    finally { setWorking(false); }
  }
  return <Modal title={title} subtitle={subtitle} onClose={close} locked={working}>
    <form onSubmit={save}><div className="form-grid">{children}</div>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="button secondary" type="button" onClick={close} disabled={working}>Cancel</button><button className={destructive ? "button secondary danger" : "button primary"} disabled={working || disabled}>{working ? "Saving…" : label}</button></div>
    </form>
  </Modal>;
}
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function ReceiptDialog({ workspace, initialClaim, incomeId, close, save }: {
  workspace: Workspace; initialClaim?: string; incomeId?: string; close: () => void; save: (receipts: Receipt[]) => Promise<void>;
}) {
  const [id] = useState(newId);
  const [selection, setSelection] = useState(initialClaim ?? "");
  const [extras, setExtras] = useState<{ key: string; id: string }[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState(incomeId ? "link" : "record");
  const [incomeSelection, setIncomeSelection] = useState(incomeId ?? "");
  const [paymentDate, setPaymentDate] = useState<string | null>(null);
  const [depositId, setDepositId] = useState<string | null>(null);
  const linked = new Set(workspace.reimbursement_receipts.map(receipt => receipt.income_entry_id));
  const openClaims = claims(workspace).filter(item => item.remaining > 0 && item.entry.occurred_on <= today());
  const claim = openClaims.find(item => item.key === selection);
  const currency = currencyForAccount(workspace, claim?.entry.account_id ?? "");
  const sheet = workspace.accounts.find(account => account.id === claim?.entry.account_id)?.ledger_id ?? null;
  const accounts = workspace.accounts.filter(account => account.kind !== "investment" && !account.archived &&
    accountCurrency(account) === currency && (account.ledger_id ?? null) === sheet);
  const eligibleIncome = claim ? workspace.transactions.filter(entry => entry.kind === "income" && !linked.has(entry.id) &&
    (!incomeId || entry.id === incomeId) && entry.amount_minor <= claim.remaining &&
    entry.occurred_on >= claim.entry.occurred_on && entry.occurred_on <= today() &&
    accounts.some(account => account.id === entry.account_id))
    .toSorted((a, b) => b.occurred_on.localeCompare(a.occurred_on)) : [];
  const income = eligibleIncome.find(entry => entry.id === incomeSelection);
  const linking = mode === "link";
  const selected = claim ? [{ key: claim.key, id }, ...extras].map(item => ({
    ...item, claim: openClaims.find(open => open.key === item.key),
  })) : [];
  const nextClaims = openClaims.filter(item => !selected.some(row => row.key === item.key) &&
    currencyForAccount(workspace, item.entry.account_id) === currency);
  const firstPaymentDate = selected.reduce((date, row) => row.claim && row.claim.entry.occurred_on > date ? row.claim.entry.occurred_on : date, "");
  const paymentTotal = selected.reduce((sum, row) => sum + (row.key in amounts ? parseMoney(amounts[row.key], currency) ?? 0 : row.claim?.remaining ?? 0), 0);
  const setAmount = (key: string, amount: string) => setAmounts(current => ({ ...current, [key]: amount }));
  const defaultDeposit = accounts.find(account => account.id === claim?.entry.account_id)?.id ?? "";
  const deposit = accounts.find(account => account.id === (linking ? income?.account_id : depositId ?? defaultDeposit));
  const recordDate = paymentDate ?? firstPaymentDate;
  const receivedOn = linking ? income?.occurred_on : recordDate;
  const beforeTracking = deposit && receivedOn && receivedOn < deposit.opening_date;
  async function submit(data: FormData) {
    if (!claim) throw Error("Choose an outstanding reimbursement.");
    const receipt = { id, expense_id: claim.entry.id, claim_id: claim.id };
    if (linking) {
      if (!income) throw Error("Choose an eligible income entry.");
      await save([{ ...receipt, income_entry_id: income.id, account_id: income.account_id,
        received_on: income.occurred_on, amount_minor: income.amount_minor, notes: income.notes }]);
      return;
    }
    const date = parseDate(value(data, "date"));
    if (!date || date < firstPaymentDate || date > today()) throw Error("Choose a payment date on or after every selected expense date, through today.");
    if (!deposit) throw Error("Choose a deposit account.");
    const notes = value(data, "notes");
    const receipts = selected.map((row, index) => {
      if (!row.claim) throw Error("A selected claim is no longer outstanding.");
      const amount = parseMoney(value(data, index === 0 ? "amount" : "amount-" + row.id), currency);
      if (!amount || amount > row.claim.remaining) throw Error("Enter a positive amount up to " + money(row.claim.remaining, currency) + " for " + row.claim.entry.description + ".");
      return {
        id: row.id, expense_id: row.claim.entry.id, claim_id: row.claim.id,
        account_id: deposit.id, received_on: date, amount_minor: amount, notes,
        ...(selected.length > 1 ? { payment_group_id: id } : {}),
      };
    });
    if (!Number.isSafeInteger(receipts.reduce((sum, row) => sum + row.amount_minor, 0))) throw Error("The combined payment amount is too large.");
    await save(receipts.toSorted((a, b) => a.expense_id.localeCompare(b.expense_id) || a.claim_id.localeCompare(b.claim_id)));
  }
  return <TaskForm title={incomeId ? "Link to reimbursement" : "Reimbursement payment"}
    subtitle="Apply one deposit to one or more outstanding claims." close={close} submit={submit} label={linking ? "Link payment" : "Record payment"}
    disabled={!claim || (linking && !income) || (!linking && !accounts.length)}>
    {!openClaims.length && <p className="full muted">There are no outstanding reimbursements on this sheet.</p>}
    {!!openClaims.length && <Field label="Reimbursement" full><Picker label="Reimbursement" value={selection}
      onValueChange={key => { setSelection(key); setExtras([]); setAmounts({}); setIncomeSelection(incomeId ?? ""); setPaymentDate(null); setDepositId(null); }}
      options={[{ value: "", label: "Choose reimbursement" }, ...openClaims.map(item => ({
        value: item.key, label: item.counterparty + " · " + item.entry.description + " · " + money(item.remaining, currencyForAccount(workspace, item.entry.account_id)),
      }))]}/></Field>}
    {claim && <>
      <div className="payment-summary full"><HandCoins size={21}/><div><small>Amount outstanding</small><strong>{money(claim.remaining, currency)}</strong></div></div>
      {!incomeId && <fieldset className="reimbursement-choice full"><legend>Payment source</legend>
        <label><input type="radio" checked={!linking} onChange={() => setMode("record")} name="payment-source"/>Record a payment</label>
        <label><input type="radio" checked={linking} disabled={!!extras.length} onChange={() => setMode("link")} name="payment-source"/>Link existing income</label>
      </fieldset>}
      {linking ? <>
        {!!eligibleIncome.length && <Field label="Income entry" full hint="The original deposit will be shown as a reimbursement payment.">
          <Picker label="Income entry" value={incomeSelection} onValueChange={setIncomeSelection}
            options={[{ value: "", label: "Choose income entry" }, ...eligibleIncome.map(entry => ({
              value: entry.id, label: entry.description + " · " + dayLabel(entry.occurred_on) + " · " + money(entry.amount_minor, currency),
            }))]}/></Field>}
        {!eligibleIncome.length && <p className="full muted">{incomeId ? "This income entry does not match this claim’s currency, dates, or outstanding amount." : "No unlinked income matches this claim’s currency, dates, and outstanding amount."}</p>}
      </> : <div className="form-grid payment-fields full" key={claim.key}>
        {selected.length === 1 ? <Field label={`Amount received (${currencyLabel(currency)})`}><MoneyInput currency={currency} name="amount"
          defaultValue={formatMoneyInput(amounts[claim.key] ?? amountText(claim.remaining, currency), currency)} onChange={event => setAmount(claim.key, event.target.value)} required /></Field>
          : <fieldset className="payment-allocations full">
            <legend>Apply deposit to claims</legend>
            {selected.map((row, index) => row.claim && <div className="payment-allocation" key={row.id}>
              <Field label={row.claim.counterparty + " · " + row.claim.entry.description} hint={"Outstanding " + money(row.claim.remaining, currency)}>
                <MoneyInput currency={currency} name={index === 0 ? "amount" : "amount-" + row.id}
                  defaultValue={formatMoneyInput(amounts[row.key] ?? amountText(row.claim.remaining, currency), currency)}
                  onChange={event => setAmount(row.key, event.target.value)} required/>
              </Field>
              {index > 0 && <button type="button" className="icon-button" aria-label={"Remove " + row.claim.entry.description + " for " + row.claim.counterparty}
                onClick={() => {
                  setExtras(current => current.filter(item => item.id !== row.id));
                  setAmounts(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== row.key)));
                }}><X size={17}/></button>}
            </div>)}
            <div className="payment-total" aria-live="polite"><span>Total deposit</span><strong>{money(paymentTotal, currency)}</strong></div>
          </fieldset>}
        <Field label="Date received"><DatePicker label="Date received" name="date" value={recordDate} onChange={setPaymentDate} min={firstPaymentDate} max={today()} required/></Field>
        {!!nextClaims.length && <Field label="Add another claim" full><Picker label="Add another claim" value=""
          onValueChange={key => {
            if (!key) return;
            const allocation = { key, id: newId() };
            setExtras(current => [...current, allocation]);
          }}
          options={[{ value: "", label: "Choose another reimbursement" }, ...nextClaims.map(item => ({
            value: item.key, label: item.counterparty + " · " + item.entry.description + " · " + money(item.remaining, currency),
          }))]}/></Field>}
        <Field label="Deposit account" full><Picker label="Deposit account" name="account" value={depositId ?? defaultDeposit} onValueChange={setDepositId}
          options={[{ value: "", label: "Choose account" }, ...accounts.map(account => ({ value: account.id, label: account.name }))]}/></Field>
        <Field label="Notes (optional)" full><textarea name="notes" rows={2}/></Field>
      </div>}
      {beforeTracking && <p className="history-note full" role="status">This payment predates tracking for {deposit.name}. It reduces the amount owed and appears in reports. The tracked cash balance stays the same.</p>}
    </>}
  </TaskForm>;
}

export function BalanceUpdateDialog({ workspace, accountId, original, month, close, save, onDelete }: {
  workspace: Workspace; accountId?: string; original?: BalanceUpdate; month: string; close: () => void;
  save: (update: BalanceUpdate) => Promise<void>; onDelete: () => void;
}) {
  const [id] = useState(newId);
  const now = today();
  const accounts = workspace.accounts.filter(item => !item.archived && item.opening_date <= now);
  const [selected, setSelected] = useState(original?.account_id ?? accountId ?? accounts[0]?.id ?? "");
  const account = workspace.accounts.find(item => item.id === selected);
  const currency = accountCurrency(account);
  const [frequency, setFrequency] = useState<BalanceUpdate["frequency"]>(original?.frequency ?? "monthly");
  const [date, setDate] = useState(() => {
    if (original) return original.recorded_on;
    const [year, monthNumber] = month.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    const end = monthEnd < now ? monthEnd : now;
    return account && end < account.opening_date ? account.opening_date : end;
  });
  const [amount, setAmount] = useState(() => original ? original.balance_minor < 0
    ? "-" + amountText(-original.balance_minor, currency) : amountText(original.balance_minor, currency) || "0" : "");
  const validDate = !!account && parseDate(date) === date && date >= account.opening_date && date <= now;
  const existing = workspace.balance_updates.find(item => item.account_id === selected && item.recorded_on === date);
  const ledgerBalance = useMemo(() => validDate ? balanceBeforeUpdate(workspace, selected, date) : null, [workspace, selected, date, validDate]);
  const negative = /^[−-]/.test(amount.trim());
  const magnitude = amount.trim().replace(/^[−-]\s*/, "");
  const parsed = parseMoney(magnitude, currency);
  const balance = parsed === null ? null : negative ? -parsed : parsed;
  const investment = account?.kind === "investment";
  const difference = ledgerBalance === null || balance === null ? null : balance - ledgerBalance;
  async function submit() {
    if (!account || account.archived) throw Error("Choose an active account.");
    if (!validDate) throw Error("Choose a date from the account opening through today.");
    if (balance === null || (investment && balance < 0)) throw Error(investment
      ? "Enter an investment value of zero or more." : "Enter a valid ending balance.");
    if (!Number.isSafeInteger(difference)) throw Error("The balance difference is outside the supported amount range.");
    await save({ id: existing?.id ?? id, account_id: account.id, recorded_on: date, frequency, balance_minor: balance });
  }
  return <TaskForm title={original ? "Edit balance update" : "Record balance"}
    subtitle="Enter what the account held at the end of a day. Finance Studio calculates the difference from your ledger."
    close={close} submit={submit} label="Save balance" disabled={!account || account.archived}>
    <Field label="Account" full><Picker label="Balance account" value={selected} disabled={!!original} onValueChange={next => {
      setSelected(next);
      setAmount("");
      const opening = accounts.find(item => item.id === next)?.opening_date;
      if (opening && date < opening) setDate(opening);
    }} options={(original && account ? [account] : accounts).map(item => ({
      value: item.id, label: item.name + " · " + accountCurrency(item) +
        (workspace.finance_books.length ? " · " + (workspace.finance_books.find(sheet => sheet.id === item.ledger_id)?.name ?? "Personal") : ""),
    }))}/></Field>
    <Field label="Update frequency"><Picker label="Update frequency" value={frequency}
      onValueChange={next => setFrequency(next === "weekly" ? "weekly" : "monthly")}
      options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}/></Field>
    <Field label="Balance date" hint={original ? undefined : "Choose the last date you’re totaling."}>
      {original ? <strong>{dayLabel(date)}</strong> : <DatePicker label="Balance date" value={date} onChange={setDate} min={account?.opening_date} max={now} required/>}
    </Field>
    <Field label={`Actual ending balance (${currencyLabel(currency)})`} full><input inputMode="decimal" required
      value={amount} placeholder={existing ? money(existing.balance_minor, currency) : amountExample(currency)}
      onChange={event => setAmount(event.target.value)} onBlur={() => {
        if (parsed !== null) setAmount((negative ? "-" : "") + formatMoneyInput(magnitude, currency));
      }}/></Field>
    {ledgerBalance !== null && <div className="payment-summary balance-update-preview full">
      <div><small>Ledger balance on this date</small><strong>{money(ledgerBalance, currency)}</strong></div>
      {difference !== null && Number.isSafeInteger(difference) && (!investment || (balance ?? 0) >= 0) &&
        <div><small>{balanceUpdateTitle(frequency, difference, investment)}</small><strong>{signed(difference, currency)}</strong></div>}
    </div>}
    {!original && existing && <p className="full muted">Saving replaces the balance update for this account and date.</p>}
    {original && <div className="full"><button type="button" className="button danger quiet" onClick={onDelete}>Delete balance update</button></div>}
  </TaskForm>;
}

export function ValueDialog({ workspace, accountId, close, save }: { workspace: Workspace; accountId: string; close: () => void; save: Save }) {
  const [id] = useState(newId);
  const account = workspace.accounts.find(item => item.id === accountId);
  const currency = accountCurrency(account);
  const latest = workspace.investment_valuations.filter(item => item.investment_account_id === accountId).toSorted((a,b) => b.valued_on.localeCompare(a.valued_on))[0];
  async function submit(data: FormData) {
    const amount = parseMoney(value(data, "value"), currency);
    const date = parseDate(value(data, "date"));
    if (amount === null) throw Error("Enter a valid value of zero or more.");
    if (!date || !account || date < account.opening_date || date > today()) throw Error("Choose a date from the account opening through today.");
    if (workspace.balance_updates.some(item => item.account_id === accountId && item.recorded_on === date)) {
      throw Error("Edit the balance update for this date in Transactions.");
    }
    const sameDay = workspace.investment_valuations.find(item => item.investment_account_id === accountId && item.valued_on === date);
    const valuation: Valuation = { id: sameDay?.id ?? id, investment_account_id: accountId, valued_on: date, value_minor: amount };
    await save("investment_valuations", [valuation]);
  }
  return <TaskForm title="Update valuation" subtitle={accountName(workspace, accountId) + " · Enter the total investment value on this date."} close={close} submit={submit} label="Save valuation">
    <Field label={`Value (${currencyLabel(currency)})`}><MoneyInput currency={currency} name="value" placeholder={latest ? amountText(latest.value_minor, currency) : "0"} required/></Field>
    <Field label="Valuation date"><DatePicker label="Valuation date" name="date" defaultValue={today()} min={account?.opening_date} max={today()} required/></Field>
  </TaskForm>;
}

export function ManagementDialog({ edit, workspace, initialCurrency, close, save }: { edit: Management; workspace: Workspace; initialCurrency: Currency; close: () => void; save: Save }) {
  const [id] = useState(newId);
  const [fieldType, setFieldType] = useState<FieldType>(edit.collection === "field_definitions" ? edit.row?.field_type ?? "text" : "text");
  const isAccount = edit.collection === "accounts";
  const [currency, setCurrency] = useState(() => isAccount && edit.row ? accountCurrency(edit.row) : initialCurrency);
  const isCategory = edit.collection === "categories";
  const singular = isAccount ? "account" : isCategory ? "category" : edit.collection === "reimbursement_people" ? "person" : "custom field";
  async function submit(data: FormData) {
    const name = value(data, "name");
    const archived = data.has("archived");
    if (!name || name.length > 70) throw Error("Enter a name up to 70 characters.");
    if (edit.collection === "accounts") {
      const duplicate = workspace.accounts.some(row => row.id !== edit.row?.id && row.name.toLowerCase() === name.toLowerCase());
      if (duplicate) throw Error("An account with this name already exists.");
      const opening = parseMoney(value(data, "opening") || "0", currency);
      const date = parseDate(value(data, "date"));
      const kind = edit.row?.kind ?? value(data, "kind") as Account["kind"];
      if (opening === null) throw Error("Enter a starting balance like " + amountExample(currency) + ".");
      if (!date || !Object.hasOwn(kindLabels, kind)) throw Error("Enter a valid date and account type.");
      const linkedHistory = edit.row && date > edit.row.opening_date && (
        workspace.reimbursement_receipts.some(receipt => receipt.account_id === edit.row?.id && receipt.received_on < date)
        || workspace.investment_valuations.some(valuation => valuation.investment_account_id === edit.row?.id && valuation.valued_on < date)
        || workspace.balance_updates.some(update => update.account_id === edit.row?.id && update.recorded_on < date));
      if (linkedHistory) throw Error("Choose a tracking date on or before the earliest linked payment, valuation, or balance update.");
      await save("accounts", [{ id: edit.row?.id ?? id, name, kind, currency, opening_minor: opening, opening_date: date, archived }]);
    } else if (edit.collection === "categories") {
      const applicable = edit.row?.applicable_kind ?? value(data, "kind") as Category["applicable_kind"];
      if (workspace.categories.some(row => row.id !== edit.row?.id && row.applicable_kind === applicable && row.name.toLowerCase() === name.toLowerCase())) throw Error("A category with this name already exists for that type.");
      await save("categories", [{ id: edit.row?.id ?? id, name, applicable_kind: applicable, color: value(data, "color"), archived }]);
    } else if (edit.collection === "reimbursement_people") {
      if (workspace.reimbursement_people.some(row => row.id !== edit.row?.id && row.name.toLowerCase() === name.toLowerCase())) throw Error("A person with this name is already saved.");
      await save("reimbursement_people", [{ id: edit.row?.id ?? id, name, archived }]);
    } else {
      if (workspace.field_definitions.some(row => row.id !== edit.row?.id && row.label.toLowerCase() === name.toLowerCase())) throw Error("A field with this label already exists.");
      const options = fieldType === "select" ? [...new Set(value(data, "options").split("\n").map(option => option.trim()).filter(Boolean))] : [];
      if (fieldType === "select" && (!options.length || options.length > 40 || options.some(option => option.length > 100))) throw Error("Enter 1 to 40 options, one per line, up to 100 characters each.");
      const position = edit.row?.position ?? Math.max(-1, ...workspace.field_definitions.map(field => field.position)) + 1;
      await save("field_definitions", [{ id: edit.row?.id ?? id, label: name, field_type: fieldType, options, required: data.has("required"), position, archived }]);
    }
  }
  const title = (edit.row ? "Edit " : "Add ") + (isAccount ? "financial account" : singular);
  const subtitle = isAccount && !edit.row ? "Track a bank account, e-wallet, cash balance or investment. Entries you record update its balance." : undefined;
  return <TaskForm title={title} subtitle={subtitle} close={close} submit={submit} label={edit.row ? "Save changes" : title}>
    <Field label={edit.collection === "field_definitions" ? "Field label" : "Name"} full><input name="name"
      defaultValue={edit.collection === "field_definitions" ? edit.row?.label : edit.row?.name} maxLength={70} required/></Field>
    {isAccount && <>
      <Field label="Account type" full><Picker label="Account type" name="kind" defaultValue={edit.row?.kind ?? "bank"} disabled={!!edit.row}
        options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}/></Field>
      <Field label="Currency" full hint="Currency is set when you add the account."><Picker label="Account currency" value={currency} disabled={!!edit.row}
        options={currencyOptions} onValueChange={code => { if (isCurrency(code)) setCurrency(code); }}/></Field>
      <Field label={`Starting balance (${currencyLabel(currency)})`} hint="Balance at the start of tracking."><MoneyInput currency={currency} name="opening" defaultValue={edit.row ? amountText(edit.row.opening_minor, currency) : ""} placeholder={amountExample(currency)}/></Field>
      <Field label="Start tracking from" hint="Earlier entries appear in reports. This balance starts on the selected date."><DatePicker label="Start tracking from" name="date" defaultValue={edit.row?.opening_date ?? today()} required/></Field>
    </>}
    {isCategory && <>
      <Field label="Applies to"><Picker label="Applies to" name="kind" defaultValue={edit.row?.applicable_kind ?? "expense"} disabled={!!edit.row}
        options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]}/></Field>
      <Field label="Color"><Picker label="Color" name="color" defaultValue={edit.row?.color ?? "green"}
        options={palette.map(color => ({ value: color, label: color[0].toUpperCase() + color.slice(1), swatch: color }))}/></Field>
    </>}
    {edit.collection === "field_definitions" && <>
      <Field label="Field type" full><Picker label="Field type" value={fieldType} onValueChange={type => setFieldType(type as FieldType)} disabled={!!edit.row}
        options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}/></Field>
      {fieldType === "select" && <Field label="Options" hint="Enter one option per line." full><textarea name="options" defaultValue={edit.row?.options.join("\n")} rows={4} required/></Field>}
      <label className="checkbox-field full"><input name="required" type="checkbox" defaultChecked={edit.row?.required}/> Required in entry forms</label>
    </>}
    {edit.row && <label className="checkbox-field full"><input name="archived" type="checkbox" defaultChecked={edit.row.archived}/> Archive this {singular}</label>}
  </TaskForm>;
}

function SettingRow({ label, detail, glyph, onEdit, children }: { label: string; detail: string; glyph?: ReactNode; onEdit: () => void; children?: ReactNode }) {
  return <div className="setting-row">{glyph}<div><strong>{label}</strong><small>{detail}</small></div>{children}<button className="icon-button" aria-label={"Edit " + label} onClick={onEdit}><Pencil size={17}/></button></div>;
}
export function BookDialog({ book, books, onSave, close }: { book?: FinanceBook; books: FinanceBook[]; onSave: (book: FinanceBook) => Promise<void>; close: () => void }) {
  const [id] = useState(newId);
  return <TaskForm title={book ? "Rename sheet" : "Add finance sheet"} subtitle="Give this part of your finances its own accounts, categories and entries." close={close} label={book ? "Save name" : "Create sheet"} submit={async data => {
    const name = value(data, "name");
    if (!name || name.length > 60) throw Error("Enter a sheet name up to 60 characters.");
    if (name.toLowerCase() === "personal" || books.some(item => item.id !== book?.id && item.name.toLowerCase() === name.toLowerCase())) throw Error("A sheet with this name already exists.");
    await onSave({ id: book?.id ?? id, name });
  }}><Field label="Sheet name" full><input name="name" defaultValue={book?.name} placeholder="e.g. Small business" maxLength={60} required/></Field></TaskForm>;
}

export function DeleteSheetDialog({ book, close, onDelete }: { book: FinanceBook; close: () => void; onDelete: () => Promise<void> }) {
  const [name, setName] = useState("");
  const matches = name.trim() === book.name;
  return <TaskForm title="Delete this sheet?" subtitle={book.name}
    close={close} label="Delete sheet" destructive disabled={!matches} submit={async data => {
      if (value(data, "sheet-name") !== book.name) throw Error("Enter the sheet’s exact name.");
      await onDelete();
    }}>
    <p className="full muted">This permanently deletes the sheet and its accounts, transactions, reimbursements, investments, goals, and settings.</p>
    <Field label="Type the sheet name to confirm" full><input name="sheet-name" value={name}
      autoComplete="off" onChange={event => setName(event.target.value)} required/></Field>
  </TaskForm>;
}

const guideSteps = [
  ["Set up your sheets", "Start in Personal or use Add sheet to create a separate place for a business or investments. Use the sheet picker to switch before making changes."],
  ["Add your financial accounts", "Open Settings → Financial accounts. Add a bank account, wallet, cash balance or investment account. Choose its currency, then enter the balance and date from which you want to start tracking."],
  ["Record income and spending", "Choose Add entry. Select an account and enter the amount in its currency. For a batch, switch to Spreadsheet and paste rows with the account names from the current sheet."],
  ["Record an ending balance", "Choose Record balance in Overview, Transactions, or on an investment holding. Pick Weekly or Monthly, choose the last date you’re totaling, and enter the balance you see. Open the generated item in Transactions to edit it. Entries dated on or before the balance update are included when calculating the difference."],
  ["Track reimbursements", "Save people in Settings → Reimbursement people. Choose Full amount for a complete reimbursement or Split by person to add several claims. Open Reimbursements or Add entries to record a payment or link an existing income entry. Open a payment to delete it or unlink the original income."],
  ["Track investments", "Add an investment account, then record contributions or withdrawals between accounts in the same sheet and currency. In Investments, use Update valuation to record its current total value."],
  ["Review and export", "Choose Month, Year, or All time. Overview can show one sheet or All sheets, with each currency totaled separately. Select one currency to download a PDF for the selected period."],
  ["Draft with the Assistant", "Open Assistant and describe an income or expense. Review the editable preview or ask for changes in chat, then choose Submit transaction."],
  ["Customize your entry form", "In Settings, create income or expense categories and add custom fields such as an invoice reference. Fields appear in both the form and the spreadsheet."],
] as const;

export function FinanceGuide({ close }: { close: () => void }) {
  return <Modal title="Finance Studio guide" subtitle="Set up your records, then follow the steps you need." onClose={close}>
    <ol className="guide-steps">{guideSteps.map(([title, body], index) => <li key={title}><details open={index === 0 || undefined}><summary><span>{title}</span><ChevronDown size={17} aria-hidden="true"/></summary><p>{body}</p></details></li>)}</ol>
    <div className="modal-footer"><a className="button quiet push" href="mailto:whiteeorangee@gmail.com">Contact support</a><button className="button secondary" onClick={close}>Done</button></div>
  </Modal>;
}

export function Settings({ workspace, cloud, onManage, onMove, onReset, onExport, onGuide }: {
  workspace: Workspace; cloud: boolean; onManage: (edit: Management) => void; onMove: (field: Definition, direction: number) => void;
  onReset: () => void; onExport: () => void; onGuide: () => void;
}) {
  const ordered = activeFields(workspace);
  const fields = [...ordered, ...workspace.field_definitions.filter(field => field.archived)];
  const add = (collection: Management["collection"], label: string) => <button className="button secondary" onClick={() => onManage({ collection })}><Plus size={16}/>{label}</button>;
  return <div className="settings-grid">
      <section className="panel settings-panel settings-accounts">
        <SectionHeading title="Financial accounts" subtitle="Where you keep and move money" action={add("accounts", "Add financial account")}/>
        {workspace.accounts.length ? workspace.accounts.map(account => { const Icon = accountIcons[account.kind]; return <SettingRow key={account.id} label={account.name}
          detail={kindLabels[account.kind] + " · " + accountCurrency(account) + (account.archived ? " · Archived" : " · Tracked since " + dayLabel(account.opening_date))}
          glyph={<span className="glyph" data-tone={accountTones[account.kind]} aria-hidden="true"><Icon size={18}/></span>}
          onEdit={() => onManage({ collection: "accounts", row: account })}/>; }) : <p className="setting-empty">Add a bank account, wallet or cash balance to start recording transactions.</p>}
      </section>
      <section className="panel settings-panel settings-categories">
        <SectionHeading title="Categories" subtitle="Income and spending categories" action={add("categories", "Add category")}/>
        {workspace.categories.length ? workspace.categories.map(category => <SettingRow key={category.id} label={category.name}
          detail={(category.applicable_kind === "expense" ? "Expense" : "Income") + (category.archived ? " · Archived" : "")}
          glyph={<span className={"category-dot " + category.color}/>}
          onEdit={() => onManage({ collection: "categories", row: category })}/>) : <p className="setting-empty">Add categories to organize your entries.</p>}
      </section>
      <section className="panel settings-panel">
        <SectionHeading title="Custom fields" subtitle="Fields shared by form and spreadsheet entry" action={add("field_definitions", "Add field")}/>
        {fields.length ? fields.map((field, index) => <SettingRow key={field.id} label={field.label} detail={typeLabels[field.field_type] + (field.required ? " · Required" : " · Optional") + (field.archived ? " · Archived" : "")}
          onEdit={() => onManage({ collection: "field_definitions", row: field })}>
          {!field.archived && <><button className="icon-button" aria-label={"Move " + field.label + " up"} disabled={index === 0} onClick={() => onMove(field, -1)}><ArrowUp size={16}/></button><button className="icon-button" aria-label={"Move " + field.label + " down"} disabled={index === ordered.length - 1} onClick={() => onMove(field, 1)}><ArrowDown size={16}/></button></>}
        </SettingRow>) : <p className="setting-empty">Add a field for references, tags or any details you track.</p>}
      </section>
      <section className="panel settings-panel">
        <SectionHeading title="Reimbursement people" subtitle="Save names to reuse on this sheet" action={add("reimbursement_people", "Add person")}/>
        {workspace.reimbursement_people.length ? workspace.reimbursement_people.toSorted((a, b) => a.name.localeCompare(b.name)).map(person =>
          <SettingRow key={person.id} label={person.name} detail={person.archived ? "Archived" : "Saved person"}
            onEdit={() => onManage({ collection: "reimbursement_people", row: person })}/>)
          : <p className="setting-empty">Add people you regularly ask for reimbursements.</p>}
      </section>
      <section className="panel settings-panel settings-help">
        <SectionHeading title="How to use Finance Studio" subtitle="Step-by-step help for sheets, entries, and reports"/>
        <div className="button-line"><button className="button secondary" onClick={onGuide}><BookOpen size={16}/> Open guide</button><a className="button quiet" href="mailto:whiteeorangee@gmail.com">Contact support</a></div>
        {!cloud && <div className="button-line settings-demo-actions">
          <button className="button secondary" onClick={onExport}><Download size={16}/> Export demo data</button>
          <button className="button quiet danger" onClick={onReset}><RotateCcw size={16}/> Reset demo</button>
        </div>}
      </section>
  </div>;
}
