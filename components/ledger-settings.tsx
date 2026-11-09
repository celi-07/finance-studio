"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BookOpen, Download, HandCoins, Pencil, Plus, RotateCcw } from "lucide-react";
import {
  accountCurrency, accountName, activeFields, amountExample, amountText, claims, currencies, currencyForAccount, currencyLabel, dayLabel, isCurrency, money, newId, parseDate, parseMoney, today,
  type Account, type Category, type Collection, type Currency, type Field as Definition, type FieldType, type FinanceBook, type Receipt, type Valuation, type Workspace,
} from "@/lib/ledger";
import { accountIcons, accountTones, Field, Modal, palette } from "./ledger-ui";
import { Picker } from "./ledger-picker";
import { SectionHeading } from "./ledger-views";

type Save = <K extends Collection>(collection: K, rows: Workspace[K]) => Promise<void>;
export type Management = { collection: "accounts"; row?: Account } | { collection: "categories"; row?: Category } | { collection: "field_definitions"; row?: Definition };
const kindLabels = { bank: "Bank account", wallet: "E-wallet", cash: "Cash on hand", investment: "Investment account" };
const currencyOptions = Object.entries(currencies).map(([value, label]) => ({ value, label: value + " · " + label }));
const typeLabels: Record<FieldType, string> = { text: "Text", number: "Number", date: "Date", select: "Select", checkbox: "Checkbox" };

export function TaskForm({ title, subtitle, close, submit, label, children }: {
  title: string; subtitle?: string; close: () => void; submit: (data: FormData) => Promise<void>; label: string; children?: ReactNode;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const data = new FormData(event.currentTarget);
    setError(""); setWorking(true);
    try { await submit(data); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That change could not be saved."); }
    finally { setWorking(false); }
  }
  return <Modal title={title} subtitle={subtitle} onClose={close} locked={working}>
    <form onSubmit={save}><div className="form-grid">{children}</div>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="button secondary" type="button" onClick={close} disabled={working}>Cancel</button><button className="button primary" disabled={working}>{working ? "Saving…" : label}</button></div>
    </form>
  </Modal>;
}
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function ReceiptDialog({ workspace, expenseId, close, save }: { workspace: Workspace; expenseId: string; close: () => void; save: Save }) {
  const [id] = useState(newId);
  const claim = claims(workspace).find(item => item.entry.id === expenseId);
  if (!claim) return null;
  const currency = currencyForAccount(workspace, claim.entry.account_id);
  const accounts = workspace.accounts.filter(account => account.kind !== "investment" && !account.archived && accountCurrency(account) === currency);
  async function submit(data: FormData) {
    if (!claim) return;
    const amount = parseMoney(value(data, "amount"), currency);
    const date = parseDate(value(data, "date"));
    const account = accounts.find(item => item.id === value(data, "account"));
    if (!amount || amount > claim.remaining) throw Error("Enter a positive amount up to " + money(claim.remaining, currency) + ".");
    if (!date || date < claim.entry.occurred_on || date > today()) throw Error("Choose a payment date from the expense date through today.");
    if (!account || date < account.opening_date) throw Error("Choose a cash account open on the payment date.");
    const receipt: Receipt = { id, expense_id: expenseId, account_id: account.id, received_on: date, amount_minor: amount, notes: value(data, "notes") };
    await save("reimbursement_receipts", [receipt]);
  }
  return <TaskForm title="Receive payment" subtitle={claim.entry.description + " · " + claim.entry.counterparty} close={close} submit={submit} label="Record payment">
    <div className="payment-summary full"><HandCoins size={21}/><div><small>Amount outstanding</small><strong>{money(claim.remaining, currency)}</strong></div></div>
    <Field label={`Amount received (${currencyLabel(currency)})`}><input name="amount" inputMode="decimal" placeholder={amountText(claim.remaining, currency)} required /></Field>
    <Field label="Date received"><input name="date" type="date" defaultValue={today()} min={claim.entry.occurred_on} max={today()} required/></Field>
    <Field label="Deposit account" full><Picker label="Deposit account" name="account" defaultValue={accounts.some(account => account.id === claim.entry.account_id) ? claim.entry.account_id : ""}
      options={[{ value: "", label: "Choose account" }, ...accounts.map(account => ({ value: account.id, label: account.name }))]}/></Field>
    <Field label="Notes (optional)" full><textarea name="notes" rows={2}/></Field>
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
    const sameDay = workspace.investment_valuations.find(item => item.investment_account_id === accountId && item.valued_on === date);
    const valuation: Valuation = { id: sameDay?.id ?? id, investment_account_id: accountId, valued_on: date, value_minor: amount };
    await save("investment_valuations", [valuation]);
  }
  return <TaskForm title="Update valuation" subtitle={accountName(workspace, accountId) + " · Enter the total investment value on this date."} close={close} submit={submit} label="Save valuation">
    <Field label={`Value (${currencyLabel(currency)})`}><input name="value" inputMode="decimal" placeholder={latest ? amountText(latest.value_minor, currency) : "0"} required/></Field>
    <Field label="Valuation date"><input name="date" type="date" defaultValue={today()} min={account?.opening_date} max={today()} required/></Field>
  </TaskForm>;
}

export function ManagementDialog({ edit, workspace, initialCurrency, close, save }: { edit: Management; workspace: Workspace; initialCurrency: Currency; close: () => void; save: Save }) {
  const [id] = useState(newId);
  const [fieldType, setFieldType] = useState<FieldType>(edit.collection === "field_definitions" ? edit.row?.field_type ?? "text" : "text");
  const isAccount = edit.collection === "accounts";
  const [currency, setCurrency] = useState(() => isAccount && edit.row ? accountCurrency(edit.row) : initialCurrency);
  const isCategory = edit.collection === "categories";
  const singular = isAccount ? "account" : isCategory ? "category" : "custom field";
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
      const entryBeforeOpening = workspace.transactions.some(entry => (entry.account_id === edit.row?.id || entry.destination_account_id === edit.row?.id) && entry.occurred_on < date)
        || workspace.reimbursement_receipts.some(receipt => receipt.account_id === edit.row?.id && receipt.received_on < date)
        || workspace.investment_valuations.some(valuation => valuation.investment_account_id === edit.row?.id && valuation.valued_on < date);
      if (entryBeforeOpening) throw Error("Choose an opening date on or before the earliest linked entry.");
      await save("accounts", [{ id: edit.row?.id ?? id, name, kind, currency, opening_minor: opening, opening_date: date, archived }]);
    } else if (edit.collection === "categories") {
      const applicable = edit.row?.applicable_kind ?? value(data, "kind") as Category["applicable_kind"];
      if (workspace.categories.some(row => row.id !== edit.row?.id && row.applicable_kind === applicable && row.name.toLowerCase() === name.toLowerCase())) throw Error("A category with this name already exists for that type.");
      await save("categories", [{ id: edit.row?.id ?? id, name, applicable_kind: applicable, color: value(data, "color"), archived }]);
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
    <Field label={isAccount || isCategory ? "Name" : "Field label"} full><input name="name" defaultValue={isAccount || isCategory ? edit.row?.name : edit.row?.label} maxLength={70} required/></Field>
    {isAccount && <>
      <Field label="Account type" full><Picker label="Account type" name="kind" defaultValue={edit.row?.kind ?? "bank"} disabled={!!edit.row}
        options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))}/></Field>
      <Field label="Currency" full hint="Currency is set when you add the account."><Picker label="Account currency" value={currency} disabled={!!edit.row}
        options={currencyOptions} onValueChange={code => { if (isCurrency(code)) setCurrency(code); }}/></Field>
      <Field label={`Starting balance (${currencyLabel(currency)})`} hint="Balance before the first entry you’ll record."><input name="opening" inputMode="decimal" defaultValue={edit.row ? amountText(edit.row.opening_minor, currency) : ""} placeholder={amountExample(currency)}/></Field>
      <Field label="Start tracking from" hint="Use the date of your earliest entry or an earlier date."><input name="date" type="date" defaultValue={edit.row?.opening_date ?? today()} required/></Field>
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
      <label className="checkbox-field full"><input name="required" type="checkbox" defaultChecked={edit.row?.required}/> Required on new and edited entries</label>
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

const guideSteps = [
  ["Set up your sheets", "Start in Personal or use Add sheet to create a separate place for a business or investments. Use the sheet picker to switch before making changes."],
  ["Add your financial accounts", "Open Settings → Financial accounts. Add a bank account, wallet, cash balance or investment account. Choose its currency, then enter the balance and date from which you want to start tracking."],
  ["Record income and spending", "Choose Add entry. Select an account and enter the amount in its currency. For a batch, switch to Spreadsheet and paste rows with the account names from the current sheet."],
  ["Track reimbursements", "Mark an expense as reimbursable and enter the claim amount and who owes it. Open Reimbursements to record payments into an account on the same sheet and in the same currency."],
  ["Track investments", "Add an investment account, then record contributions or withdrawals between accounts in the same sheet and currency. In Investments, use Update valuation to record its current total value."],
  ["Review and export", "Choose a reporting month. Overview can show one sheet or All sheets, with each currency totaled separately. Select a currency to open the detailed view or download its monthly PDF."],
  ["Customize your entry form", "In Settings, create income or expense categories and add custom fields such as an invoice reference. Fields appear in both the form and the spreadsheet."],
] as const;

export function FinanceGuide({ close }: { close: () => void }) {
  return <Modal title="Finance Studio guide" subtitle="Set up your records, then follow the steps you need." onClose={close}>
    <ol className="guide-steps">{guideSteps.map(([title, body], index) => <li key={title}><details open={index === 0 || undefined}><summary>{title}</summary><p>{body}</p></details></li>)}</ol>
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
