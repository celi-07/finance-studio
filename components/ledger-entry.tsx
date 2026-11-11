"use client";

import { useCallback, useRef, useState, type CSSProperties, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronDown, CircleAlert, GripVertical, HandCoins, ListPlus, Plus, Trash2, UserRoundPlus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  accountCurrency, activeFields, blankDraft, currencyForAccount, currencyLabel, draftFrom, editableAccounts, formatMoneyInput, groupNumber, historicalAccounts, kinds, needsDestination, parseDate, validateSpreadsheetEntry, validateFormEntry, workspaceForCurrency,
  fullReimbursement, maxReimbursementPeople, newId, type Currency, type Entry, type EntryDraft, type Field as Definition, type Kind, type ReimbursementDraft, type ReimbursementMode, type Workspace,
} from "@/lib/ledger";
import { Field, Modal } from "./ledger-ui";
import { DatePicker, Picker } from "./ledger-picker";

type Props = {
  workspace: Workspace; month: string; currency: Currency; original?: Entry; kind?: Kind; preset?: string; initialBulk?: boolean;
  onSave: (entries: Entry[]) => Promise<void>; onDelete?: (entry: Entry) => void; onClose: () => void;
  onPayment?: () => void;
};
const maxRows = 250;
const requiredColumns = new Set(["occurred_on", "kind", "description", "amount", "account_id"]);
const batchValidationMessage = "Correct the highlighted cells before saving.";
const splitValidationMessage = "Review the highlighted reimbursement shares before saving.";
const splitColumns = new Set(["reimbursable", "counterparty", "due_on"]);
const hasDestination = (kind: string) => Object.hasOwn(kinds, kind) && needsDestination(kind);
const cellDirections = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0] } as const;
function kindMatch(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll(" ", "_");
  return Object.hasOwn(kinds, normalized) ? normalized : value.trim();
}
function changeKind(workspace: Workspace, draft: EntryDraft, kind: string) {
  if (draft.kind === kind) return draft;
  return { ...draft, kind, category_id: null,
    account_id: editableAccounts(workspace, kind).some(account => account.id === draft.account_id) ? draft.account_id : "",
    destination_account_id: null };
}
const blankShare = (): ReimbursementDraft => ({ id: newId(), amount: "", counterparty: "", due_on: null });
const savedPeople = (workspace: Workspace) => workspace.reimbursement_people.filter(person => !person.archived)
  .toSorted((a, b) => a.name.localeCompare(b.name)).map(person => ({ value: person.name, label: person.name }));

function PersonInput({ options, value, invalid, onChange }: {
  options: ReturnType<typeof savedPeople>; value: string; invalid: boolean; onChange: (name: string) => void;
}) {
  return <span className="sheet-cell person-input">
    <input value={value} maxLength={160} aria-invalid={invalid} onChange={event => onChange(event.target.value)}/>
    {!!options.length && <Picker compact label="Choose a saved person" options={options} value={value} onValueChange={onChange}/>}
  </span>;
}

function SpreadsheetChoice({ workspace, row, column, field, text, label, choose, disabled }: {
  workspace: Workspace; row: EntryDraft; column: string; field?: Definition; text: string; label: string; choose: (value: string) => void;
  disabled?: boolean;
}) {
  if (column === "occurred_on" || column === "due_on" || field?.field_type === "date") {
    return <DatePicker compact label={label} value={parseDate(text) ?? ""} onChange={choose}
      min={column === "due_on" ? parseDate(row.occurred_on) ?? undefined : undefined} required={column === "occurred_on" || field?.required}/>;
  }
  const knownType = Object.hasOwn(kinds, row.kind);
  let options: { value: string; label: string; swatch?: string; disabled?: boolean }[] = [];
  let selection = text;
  if (column === "kind") options = Object.values(kinds).map(label => ({ value: label, label }));
  else if (column === "category_id") {
    if (knownType && row.kind !== "expense" && row.kind !== "income") {
      return <Picker compact label={label + " (income and expenses only)"} options={[]} disabled/>;
    }
    selection = row.category_id ?? "";
    options = [{ value: "", label: "Uncategorized" },
      ...workspace.categories.filter(category => !category.archived && (!knownType || category.applicable_kind === row.kind))
        .map(category => ({ value: category.id, label: knownType ? category.name : category.name + " · " + kinds[category.applicable_kind], swatch: category.color })),
    ];
  } else if (column === "account_id" || column === "destination_account_id") {
    const destination = column === "destination_account_id";
    if (destination && !hasDestination(row.kind)) return <Picker compact label={label} options={[]} disabled/>;
    const source = workspace.accounts.find(account => account.id === row.account_id);
    const accounts = knownType ? editableAccounts(workspace, row.kind, destination) : workspace.accounts.filter(account => !account.archived);
    options = accounts
      .filter(account => !destination || account.id !== row.account_id && (!source || accountCurrency(account) === accountCurrency(source)))
      .map(account => ({ value: account.name, label: account.name + " · " + accountCurrency(account) }));
    if (!options.length) options = [{ value: "__unavailable__", label: "No eligible accounts for this row", disabled: true }];
  } else if (column === "reimbursable" && (!knownType || row.kind === "expense")) {
    selection = text.trim().toLowerCase() === "full" ? fullReimbursement : text;
    options = [{ value: fullReimbursement, label: "Full expense amount" }, { value: "", label: "No reimbursement" }];
  } else if (column === "counterparty" && (!knownType || row.kind === "expense")) options = savedPeople(workspace);
  else if (field?.field_type === "select") options = field.options.map(label => ({ value: label, label }));
  else if (field?.field_type === "checkbox") options = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  return options.length ? <Picker compact label={label} options={options} value={selection} onValueChange={choose} disabled={disabled}/> : null;
}
function CustomInput({ definition, value, set, invalid, prior }: {
  definition: Definition; value: string | boolean | undefined; set: (value: string | boolean) => void; invalid?: boolean; prior?: boolean;
}) {
  const current = typeof value === "string" ? value : "";
  if (definition.field_type === "checkbox") return <input aria-invalid={invalid} type="checkbox" checked={value === true} onChange={event => set(event.target.checked)} />;
  if (definition.field_type === "select") return <Picker label={definition.label} invalid={invalid} value={current} onValueChange={set}
    options={[
      { value: "", label: "Select an option" },
      ...(prior && current && !definition.options.includes(current) ? [{ value: current, label: current + " (previous option)" }] : []),
      ...definition.options.map(option => ({ value: option, label: option })),
    ]}/>;
  if (definition.field_type === "date") return <DatePicker label={definition.label} value={current} onChange={set} invalid={invalid} required={definition.required}/>;
  return <input aria-invalid={invalid} value={current} onBlur={() => { if (definition.field_type === "number") set(groupNumber(current)); }}
    inputMode={definition.field_type === "number" ? "decimal" : undefined} onChange={event => set(event.target.value)} />;
}

function SplitShares({ workspace, draft, setDraft, currency, errors }: {
  workspace: Workspace; draft: EntryDraft; setDraft: (update: (draft: EntryDraft) => EntryDraft) => void;
  currency: Currency; errors: Record<string, string>;
}) {
  const people = savedPeople(workspace);
  const unit = currencyLabel(currency);
  const setPeople = (people: ReimbursementDraft[]) => setDraft(current => ({ ...current, people }));
  const updatePerson = (id: string, values: Partial<ReimbursementDraft>) => setDraft(current => ({
    ...current, people: current.people?.map(person => person.id === id ? { ...person, ...values } : person),
  }));
  return <div className="reimbursement-people full">
    <p className="muted">Give each person their own amount and optional due date. Shares can cover part or all of this expense.</p>
    {draft.people?.map((person, index) => <fieldset className="reimbursement-person form-grid" key={person.id}>
      <legend>Person {index + 1}</legend>
      <Field label="Owed by" error={errors[person.id + "-person"]}><PersonInput options={people} value={person.counterparty}
        invalid={!!errors[person.id + "-person"]} onChange={counterparty => updatePerson(person.id, { counterparty })}/></Field>
      <Field label={`Share amount (${unit})`} error={errors[person.id + "-amount"]}><input value={person.amount} inputMode="decimal"
        aria-invalid={!!errors[person.id + "-amount"]} onBlur={() => updatePerson(person.id, { amount: formatMoneyInput(person.amount, currency) })}
        onChange={event => updatePerson(person.id, { amount: event.target.value })}/></Field>
      <Field label="Due date (optional)" error={errors[person.id + "-date"]}><DatePicker label={"Due date for person " + (index + 1)} value={person.due_on ?? ""}
        min={parseDate(draft.occurred_on) ?? undefined} invalid={!!errors[person.id + "-date"]} onChange={date => updatePerson(person.id, { due_on: date || null })}/></Field>
      <button className="button danger quiet remove-reimbursement-person" type="button" aria-label={"Remove person " + (index + 1)}
        disabled={(draft.people?.length ?? 0) <= 1 || workspace.reimbursement_receipts.some(receipt => receipt.expense_id === draft.id && (receipt.claim_id ?? draft.id) === person.id)}
        onClick={() => setPeople((draft.people ?? []).filter(item => item.id !== person.id))}><Trash2 size={16}/> Remove</button>
    </fieldset>)}
    {errors.reimbursable && <small className="field-error" role="alert">{errors.reimbursable}</small>}
    <button className="button secondary" type="button" disabled={(draft.people?.length ?? 0) >= maxReimbursementPeople}
      onClick={() => setPeople([...(draft.people ?? []), blankShare()])}><Plus size={16}/> Add person</button>
  </div>;
}

export function EntryFields({ workspace, draft, setDraft, currency, original, errors, claim, setClaim, lockCurrency }: {
  workspace: Workspace; draft: EntryDraft; setDraft: (update: (draft: EntryDraft) => EntryDraft) => void;
  currency: Currency; original?: Entry; errors: Record<string, string>; claim: ReimbursementMode; setClaim: (claim: ReimbursementMode) => void; lockCurrency?: boolean;
}) {
  const fields = activeFields(workspace);
  const people = savedPeople(workspace);
  const entryCurrency = draft.account_id ? currencyForAccount(workspace, draft.account_id) : currency;
  const unit = currencyLabel(entryCurrency);
  const activeCategories = workspace.categories.filter(category => category.applicable_kind === draft.kind && (!category.archived || original?.category_id === category.id));
  const set = <K extends keyof EntryDraft,>(key: K, value: EntryDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const beforeTracking = historicalAccounts(workspace, draft);
  const availableAccounts = (destination: boolean) => editableAccounts(workspace, draft.kind, destination, destination ? original?.destination_account_id : original?.account_id)
    .filter(account => destination ? accountCurrency(account) === entryCurrency : (original || lockCurrency) ? accountCurrency(account) === entryCurrency : true);
  return <>
      <div className="form-grid">
        <Field label="Type" error={errors.kind}><Picker label="Type" value={draft.kind} invalid={!!errors.kind}
          onValueChange={kind => setDraft(current => changeKind(workspace, current, kind))}
          options={Object.entries(kinds).filter(([value]) => !lockCurrency || value === "expense" || value === "income").map(([value, label]) => ({ value, label }))}/></Field>
        <Field label="Date" error={errors.occurred_on}><DatePicker label="Date" value={draft.occurred_on} invalid={!!errors.occurred_on} required onChange={date => set("occurred_on", date)}/></Field>
        <Field label={`Amount (${unit})`} error={errors.amount} full><input className="entry-amount" value={draft.amount} inputMode="decimal" placeholder="0" aria-invalid={!!errors.amount}
          onBlur={() => set("amount", formatMoneyInput(draft.amount, entryCurrency))} onChange={event => set("amount", event.target.value)} /></Field>
        <Field label="Description" error={errors.description} full><input value={draft.description} placeholder="e.g. Grocery run" aria-invalid={!!errors.description} onChange={event => set("description", event.target.value)} /></Field>
        <Field label={needsDestination(draft.kind) ? "From account" : "Account"} error={errors.account_id}>
          <Picker label={needsDestination(draft.kind) ? "From account" : "Account"} value={draft.account_id} invalid={!!errors.account_id}
            onValueChange={id => setDraft(current => ({ ...current, account_id: id,
              destination_account_id: current.destination_account_id && currencyForAccount(workspace, current.destination_account_id) === currencyForAccount(workspace, id) ? current.destination_account_id : null }))}
            options={[{ value: "", label: "Choose account" }, ...availableAccounts(false).map(account => ({ value: account.id, label: `${account.name} · ${accountCurrency(account)}` }))]}/>
        </Field>
        {needsDestination(draft.kind) ? <Field label="To account" error={errors.destination_account_id}>
          <Picker label="To account" value={draft.destination_account_id ?? ""} invalid={!!errors.destination_account_id}
            onValueChange={id => set("destination_account_id", id || null)}
            options={[{ value: "", label: "Choose account" }, ...availableAccounts(true).filter(account => account.id !== draft.account_id).map(account => ({ value: account.id, label: account.name }))]}/>
        </Field> : <Field label="Category" error={errors.category_id}>
          <Picker label="Category" value={draft.category_id ?? ""} invalid={!!errors.category_id}
            onValueChange={id => set("category_id", id || null)}
            options={[{ value: "", label: "Uncategorized" }, ...activeCategories.map(category => ({ value: category.id, label: category.name, swatch: category.color }))]}/>
        </Field>}
        {draft.kind === "expense" && <fieldset className="reimbursement-choice full"><legend>Reimbursement</legend>
          {(["none", "partial", "full", "split"] as const).map((value, index) => <label key={value}>
            <input type="radio" value={value} checked={claim === value} onChange={() => {
              if (value === "split" && !draft.people) set("people", [
                { id: draft.id, amount: claim === "full" ? draft.amount : draft.reimbursable, counterparty: draft.counterparty, due_on: draft.due_on },
                blankShare(),
              ]);
              setClaim(value);
            }} name="reimbursement-mode"/>
            <span>{["None", "Partial", "Full amount", "Split by person"][index]}</span>
          </label>)}
          {claim === "none" && errors.reimbursable && <small className="field-error full" role="alert">{errors.reimbursable}</small>}
        </fieldset>}
        {draft.kind === "expense" && claim === "split" && <SplitShares workspace={workspace} draft={draft} setDraft={setDraft} currency={entryCurrency} errors={errors}/>}
        {draft.kind === "expense" && (claim === "partial" || claim === "full") && <>
          <Field label={`Reimbursable amount (${unit})`} error={errors.reimbursable} hint={claim === "full" ? "Matches the full expense amount." : undefined}>
            <input value={claim === "full" ? draft.amount : draft.reimbursable} readOnly={claim === "full"} aria-invalid={!!errors.reimbursable} inputMode="decimal" placeholder="0"
              onBlur={() => { if (claim === "partial") set("reimbursable", formatMoneyInput(draft.reimbursable, entryCurrency)); }} onChange={event => set("reimbursable", event.target.value)}/>
          </Field>
          <Field label="Owed by" error={errors.counterparty}><PersonInput options={people} value={draft.counterparty}
            invalid={!!errors.counterparty} onChange={name => set("counterparty", name)}/></Field>
          <Field label="Due date (optional)" error={errors.due_on}><DatePicker label="Due date" value={draft.due_on ?? ""} invalid={!!errors.due_on} onChange={date => set("due_on", date || null)}/></Field>
        </>}
        {fields.map(definition => <Field key={definition.id} label={definition.label + (definition.required ? " *" : " (optional)")} error={errors[definition.id]}>
          <CustomInput definition={definition} prior={!!original} value={draft.custom[definition.id]} invalid={!!errors[definition.id]}
            set={value => setDraft(current => ({ ...current, custom: { ...current.custom, [definition.id]: value } }))} />
        </Field>)}
        {original && workspace.field_definitions.filter(definition => definition.archived && Object.hasOwn(original.custom_values, definition.id)).map(definition => <div className="archived-field" key={definition.id}><span>{definition.label} (archived)</span><strong>{String(original.custom_values[definition.id])}</strong></div>)}
        <Field label="Notes (optional)" full><textarea value={draft.notes} rows={2} onChange={event => set("notes", event.target.value)} /></Field>
      </div>
      {beforeTracking.length > 0 && <p className="history-note" role="status">This entry predates tracking for {beforeTracking.map(account => account.name).join(", ")}. It appears in reports, and the affected tracked {beforeTracking.length === 1 ? "balance stays" : "balances stay"} the same.</p>}
  </>;
}

export function EntryDialog({ workspace, month, currency, original, kind, preset, initialBulk, onSave, onDelete, onClose, onPayment }: Props) {
  const make = () => {
    const scope = workspaceForCurrency(workspace, preset ? currencyForAccount(workspace, preset) : currency);
    return blankDraft(scope.accounts.length ? scope : workspace, month, kind, preset);
  };
  const originalCurrency = original ? currencyForAccount(workspace, original.account_id) : currency;
  const [draft, setDraft] = useState(() => original ? draftFrom(original, originalCurrency) : make());
  const [bulk, setBulk] = useState(!!initialBulk);
  const makeRow = () => ({ ...make(), occurred_on: "", kind: "", account_id: "", destination_account_id: null });
  const [rows, setRows] = useState<EntryDraft[]>(() => [makeRow()]);
  const [splitRowId, setSplitRowId] = useState<string | null>(null);
  const splitIndex = rows.findIndex(row => row.id === splitRowId && row.kind === "expense" && row.people);
  const splitRow = rows[splitIndex];
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ row: string; anchor: number; columns: number[] } | null>(null);
  const [fill, setFill] = useState<{ start: number; end: number; columns: number[] } | null>(null);
  const dragFill = useRef<typeof fill>(null);
  const [rowMove, setRowMove] = useState<{ source: string; target: string } | null>(null);
  const dragRow = useRef<typeof rowMove>(null);
  const movingRowIndex = rowMove ? rows.findIndex(row => row.id === rowMove.source) : -1;
  const editingCell = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const bindGrid = useCallback((node: HTMLDivElement | null) => {
    grid.current = node;
    setDialog(node?.closest("dialog") ?? null);
  }, []);
  const [rowErrors, setRowErrors] = useState<Record<string, Record<string, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const [claim, setClaim] = useState<ReimbursementMode>(() => original?.reimbursement_claims ? "split" : original?.reimbursable_minor
    ? original.reimbursable_minor === original.amount_minor ? "full" : "partial" : "none");
  const fields = activeFields(workspace);
  const earlyRows = rows.filter(row => (row.description.trim() || row.amount.trim()) && historicalAccounts(workspace, row).length).length;
  const fixedColumns = [
    ["occurred_on", "Date", "Date the transaction happened. Type YYYY-MM-DD or DD/MM/YYYY, or pick a day."],
    ["kind", "Type", "How the money moved, such as income, expense, transfer, or an investment movement."],
    ["description", "Description", "A short name for the transaction, such as Groceries."],
    ["amount", "Amount", "Full transaction amount in the source account’s currency."],
    ["account_id", "Account", "The account the money came from, or the account that received income."],
    ["category_id", "Category", "Optional label for an income or expense. The options follow the selected type."],
    ["destination_account_id", "Destination", "Receiving account for a transfer or investment movement. Use the same currency."],
    ["reimbursable", "Reimbursement (optional)", "Choose Full to use the expense amount, or enter a partial amount."],
    ["counterparty", "Owed by", "The person or organization paying the reimbursement."],
    ["due_on", "Due date", "Optional deadline for the reimbursement. Leave blank if there is no deadline."],
    ["notes", "Notes", "Optional context to keep with the transaction."],
  ] as const;
  const columns = [...fixedColumns, ...fields.map(field => [field.id, field.label,
    `${field.required ? "Required" : "Optional"} custom field · ${field.field_type}.`] as const)];
  const fieldById = new Map(fields.map(field => [field.id, field]));
  const match = (name: string, items: { id: string; name: string }[]) =>
    items.find(item => item.name.toLowerCase() === name.trim().toLowerCase() || item.id === name.trim())?.id ?? name.trim();
  function cellText(row: EntryDraft, key: string): string {
    if (fieldById.has(key)) return String(row.custom[key] ?? "");
    const value = row[key as keyof EntryDraft];
    if (typeof value !== "string") return "";
    if (key === "account_id" || key === "destination_account_id") return workspace.accounts.find(account => account.id === value)?.name ?? value;
    if (key === "category_id") return workspace.categories.find(category => category.id === value)?.name ?? value;
    return key === "kind" && Object.hasOwn(kinds, value) ? kinds[value as Kind] : value;
  }
  function assign(row: EntryDraft, key: string, value: string): EntryDraft {
    const field = fieldById.get(key);
    if (field) {
      let next: string | boolean = value;
      if (field.field_type === "checkbox") {
        const choice = value.trim();
        if (/^(true|yes|1|checked|x)$/i.test(choice)) next = true;
        else if (/^(false|no|0|unchecked)$/i.test(choice)) next = false;
      }
      return { ...row, custom: { ...row.custom, [key]: next } };
    }
    if (row.people && splitColumns.has(key)) return row;
    if (key === "kind") {
      const kind = kindMatch(value);
      const category = row.category_id;
      const typedCategory = category && !workspace.categories.some(item => item.id === category);
      const category_id = typedCategory ? match(category, workspace.categories.filter(item => item.applicable_kind === kind)) : category;
      return { ...row, kind, category_id, destination_account_id: hasDestination(kind) ? row.destination_account_id : null };
    }
    if (key === "destination_account_id" && !hasDestination(row.kind)) return row;
    if (key === "account_id" || key === "destination_account_id") return { ...row, [key]: match(value, workspace.accounts) };
    if (key === "category_id") {
      const typed = value.trim();
      const exact = workspace.categories.find(category => category.id === typed);
      const choices = workspace.categories.filter(category => !category.archived
        && (!Object.hasOwn(kinds, row.kind) || category.applicable_kind === row.kind)
        && category.name.toLowerCase() === typed.toLowerCase());
      return { ...row, category_id: (exact?.id ?? (choices.length === 1 ? choices[0].id : typed)) || null };
    }
    return { ...row, [key]: value };
  }
  const usedRow = (row: EntryDraft) => !!row.people?.length || columns.some(([key]) => cellText(row, key).trim());
  const validateRow = (row: EntryDraft) => validateSpreadsheetEntry(workspace, row);
  function updateCell(row: EntryDraft, key: string, value: string) {
    updateRow(row, item => assign(item, key, value));
  }
  function updateRow(row: EntryDraft, change: (item: EntryDraft) => EntryDraft) {
    setRows(current => current.map(item => item.id === row.id ? change(item) : item));
    if (!rowErrors[row.id]) return;
    const edited = change(row);
    const errors = usedRow(edited) ? validateRow(edited).errors : undefined;
    const next = { ...rowErrors };
    if (errors) next[row.id] = errors;
    else delete next[row.id];
    setRowErrors(next);
    if (!Object.keys(next).length && (problem === batchValidationMessage || problem === splitValidationMessage)) setProblem("");
  }
  function openSplit(row: EntryDraft) {
    if (!row.people) {
      const amount = row.reimbursable.trim().toLowerCase() === fullReimbursement.toLowerCase() ? row.amount : row.reimbursable;
      const people = [{ id: row.id, amount, counterparty: row.counterparty, due_on: row.due_on }, blankShare()];
      updateRow(row, item => ({ ...item, people }));
    }
    setSplitRowId(row.id);
    requestAnimationFrame(() => document.getElementById("sheet-split-editor")?.focus());
  }
  function closeSplit(rowId: string) {
    setSplitRowId(null);
    requestAnimationFrame(() => document.getElementById("sheet-split-" + rowId)?.focus());
  }
  function paste(event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    const value = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(value)) return;
    event.preventDefault();
    const pasted = value.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n").map(line => line.split("\t"));
    const hasHeader = columnIndex === 0 && /^(date|occurred_on)$/i.test(pasted[0]?.[0]?.trim() ?? "") && /^(type|kind)$/i.test(pasted[0]?.[1]?.trim() ?? "");
    if (hasHeader) pasted.shift();
    if (rowIndex + pasted.length > maxRows) { setProblem("Paste up to 250 rows at a time."); return; }
    if (pasted.some(line => line.length + columnIndex > columns.length)) { setProblem("The pasted cells exceed the available columns. Start at the matching first column."); return; }
    const destinationOffset = columns.findIndex(([key]) => key === "destination_account_id") - columnIndex;
    const typeOffset = columns.findIndex(([key]) => key === "kind") - columnIndex;
    const skippedDestination = pasted.some((line, offset) => line[destinationOffset]?.trim() &&
      !hasDestination(kindMatch(line[typeOffset] ?? rows[rowIndex + offset]?.kind ?? "")));
    setProblem(skippedDestination ? "Skipped pasted destinations on rows without a transfer or investment movement type." : "");
    setRowErrors({});
    setRows(current => {
      const next = [...current];
      pasted.forEach((line, offset) => {
        const index = rowIndex + offset;
        let row = next[index] ?? makeRow();
        line.forEach((cell, i) => { row = assign(row, columns[columnIndex + i][0], cell); });
        next[index] = row;
      });
      return next;
    });
  }
  function selectCell(event: MouseEvent<HTMLInputElement>, row: string, column: number) {
    const range = event.shiftKey;
    const toggle = event.ctrlKey || event.metaKey;
    setSelected(current => {
      if (!current || current.row !== row || (!range && !toggle)) return { row, anchor: column, columns: [column] };
      if (range) {
        const first = Math.min(current.anchor, column);
        return { ...current, columns: Array.from({ length: Math.abs(current.anchor - column) + 1 }, (_, index) => first + index) };
      }
      const next = current.columns.includes(column) ? current.columns.filter(value => value !== column) : [...current.columns, column];
      return next.length ? { row, anchor: next.includes(column) ? column : next.at(-1)!, columns: next } : null;
    });
  }
  function fillFrom(start: number, end: number, selectedColumns: number[]) {
    if (end === start) return;
    const keys = selectedColumns.toSorted((a, b) => a - b).map(column => columns[column][0]);
    setRows(current => {
      const source = current[start];
      if (!source) return current;
      const cells = keys.filter(key => (!source.people || !splitColumns.has(key)) &&
        (key !== "destination_account_id" || hasDestination(source.kind)))
        .map(key => [key, cellText(source, key)] as const);
      return current.map((row, index) => index !== start && index >= Math.min(start, end) && index <= Math.max(start, end)
        ? cells.reduce((next, [key, value]) => assign(next, key, value), row) : row);
    });
    setRowErrors({});
  }
  function beginFill(event: PointerEvent<HTMLButtonElement>, start: number, column: number) {
    if (working || event.button !== 0 || dragRow.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selectedColumns = selected?.row === rows[start].id && selected.columns.includes(column) ? selected.columns : [column];
    dragFill.current = { start, end: start, columns: selectedColumns };
    setFill(dragFill.current);
  }
  function rowAtPointer(event: PointerEvent<HTMLElement>) {
    if (!grid.current) return;
    const area = grid.current.getBoundingClientRect();
    if (event.clientY > area.bottom - 24) grid.current.scrollTop += 16;
    else if (event.clientY < area.top + 45) grid.current.scrollTop -= 16;
    const bodyTop = grid.current.querySelector("thead")?.getBoundingClientRect().bottom ?? area.top;
    const row = document.elementFromPoint(Math.min(area.right - 4, Math.max(area.left + 4, event.clientX)),
      Math.min(area.bottom - 4, Math.max(bodyTop + 1, event.clientY)))?.closest<HTMLElement>("tr[data-sheet-row]");
    if (row) return Number(row.dataset.sheetRow);
  }
  function moveFill(event: PointerEvent<HTMLButtonElement>) {
    const selection = dragFill.current;
    if (!selection) return;
    const end = rowAtPointer(event);
    if (end === undefined || end === selection.end) return;
    dragFill.current = { ...selection, end };
    setFill(dragFill.current);
  }
  function finishFill(commit: boolean) {
    const selection = dragFill.current;
    dragFill.current = null;
    setFill(null);
    if (selection && commit) fillFrom(selection.start, selection.end, selection.columns);
  }
  function addRows(count: number, anchorId?: string, position: "above" | "below" = "above") {
    setRows(current => {
      const anchor = anchorId ? current.findIndex(row => row.id === anchorId) : current.length;
      if (anchor < 0) return current;
      const at = anchorId && position === "below" ? anchor + 1 : anchor;
      const inserted = Array.from({ length: Math.min(count, maxRows - current.length) }, makeRow);
      return [...current.slice(0, at), ...inserted, ...current.slice(at)];
    });
  }
  function moveRow(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setRows(current => {
      const source = current.findIndex(row => row.id === sourceId);
      const target = current.findIndex(row => row.id === targetId);
      if (source < 0 || target < 0) return current;
      const next = [...current];
      const [row] = next.splice(source, 1);
      next.splice(target, 0, row);
      return next;
    });
  }
  function beginRowMove(event: PointerEvent<HTMLSpanElement>, rowId: string) {
    if (working || event.button !== 0 || !event.isPrimary || rows.length < 2 || dragFill.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRow.current = { source: rowId, target: rowId };
    setRowMove(dragRow.current);
  }
  function previewRowMove(event: PointerEvent<HTMLSpanElement>) {
    const move = dragRow.current;
    if (!move) return;
    const index = rowAtPointer(event);
    const target = index === undefined ? undefined : rows[index]?.id;
    if (!target || target === move.target) return;
    dragRow.current = { ...move, target };
    setRowMove(dragRow.current);
  }
  function finishRowMove(event?: PointerEvent<HTMLSpanElement>) {
    const move = dragRow.current;
    dragRow.current = null;
    setRowMove(null);
    const area = grid.current?.getBoundingClientRect();
    if (move && event && area && event.clientX >= area.left && event.clientX < area.right &&
      event.clientY >= area.top && event.clientY < area.bottom) {
      moveRow(move.source, move.target);
    }
  }
  function focusCell(index: number, col: number) {
    const input = grid.current?.querySelector<HTMLInputElement>("#cell-" + index + "-" + col);
    if (!input || input.disabled) return false;
    input.focus();
    setSelected({ row: rows[index].id, anchor: col, columns: [col] });
    return true;
  }
  function advance(event: KeyboardEvent<HTMLInputElement>, index: number, col: number) {
    if (event.nativeEvent.isComposing || working) return;
    const copyFromBelow = event.altKey && event.shiftKey && event.key === "ArrowUp";
    const copyFromAbove = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "d";
    const sourceIndex = index + (copyFromBelow ? 1 : -1);
    if ((copyFromBelow || copyFromAbove) && sourceIndex >= 0 && sourceIndex < rows.length) {
      event.preventDefault();
      const selectedColumns = selected?.row === rows[index].id && selected.columns.includes(col) ? selected.columns : [col];
      fillFrom(sourceIndex, index, selectedColumns);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      editingCell.current = true;
      const input = event.currentTarget;
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    if (editingCell.current && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editingCell.current = false;
      return;
    }
    if (!Object.hasOwn(cellDirections, event.key)) return;
    const enter = event.key === "Enter";
    if (!enter && (editingCell.current || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) return;
    event.preventDefault();
    const [rowStep, columnStep] = cellDirections[event.key as keyof typeof cellDirections];
    let nextRow = index + rowStep;
    let nextColumn = col + columnStep;
    while (nextRow >= 0 && nextRow < rows.length && nextColumn >= 0 && nextColumn < columns.length) {
      if (focusCell(nextRow, nextColumn)) return;
      nextRow += rowStep;
      nextColumn += columnStep;
    }
    if (enter && rows.length < maxRows) {
      addRows(1);
      setSelected(null);
      requestAnimationFrame(() => grid.current?.querySelector<HTMLInputElement>("#cell-" + nextRow + "-" + col)?.focus());
    }
  }
  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setProblem("");
    const result = validateFormEntry(workspace, draft, claim);
    setErrors(result.errors ?? {});
    if (!result.entry) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('dialog [aria-invalid="true"]')?.focus());
      return;
    }
    const saveAnother = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "another";
    setWorking(true);
    try {
      await onSave([result.entry]);
      if (saveAnother) { setDraft(make()); setClaim("none"); }
      else onClose();
    } catch (error) { setProblem(error instanceof Error ? error.message : "The entry could not be saved."); }
    finally { setWorking(false); }
  }
  async function saveRows(event: FormEvent) {
    event.preventDefault();
    if (working || splitRow) return;
    const filled = rows.filter(usedRow);
    if (!filled.length) { setProblem("Enter at least one row to save."); return; }
    const parsed = filled.map(row => [row.id, validateRow(row)] as const);
    const invalid = Object.fromEntries(parsed.flatMap(([id, result]) => result.errors ? [[id, result.errors]] : []));
    setRowErrors(invalid);
    if (Object.keys(invalid).length) {
      const invalidSplit = filled.find(row => row.people && row.kind === "expense" &&
        Object.keys(invalid[row.id] ?? {}).some(key => key === "reimbursable" || row.people?.some(person => key.startsWith(person.id + "-"))));
      setProblem(invalidSplit && Object.values(invalid).every(errors => !Object.keys(errors).some(key => requiredColumns.has(key)))
        ? splitValidationMessage : batchValidationMessage);
      if (invalidSplit) setSplitRowId(invalidSplit.id);
      requestAnimationFrame(() => (document.querySelector<HTMLElement>('dialog [aria-invalid="true"]:not(:disabled)') ?? document.getElementById("sheet-split-editor"))?.focus());
      return;
    }
    setProblem(""); setWorking(true);
    try { await onSave(parsed.flatMap(([, result]) => result.entry ? [result.entry] : [])); onClose(); }
    catch (error) { setProblem(error instanceof Error ? error.message : "The rows could not be saved."); }
    finally { setWorking(false); }
  }
  return <Modal title={original ? "Edit entry" : "Add entries"} subtitle={original ? "Update the details in your ledger." : "Choose how to enter your transactions."} onClose={onClose} wide={bulk} accentHeader locked={working}>
    {!original && <div className="entry-toolbar"><div className="mode-switch segmented" style={{ "--selection": bulk ? 1 : 0 } as CSSProperties} role="group" aria-label="Entry mode">
      <button type="button" aria-pressed={!bulk} onClick={() => { setBulk(false); setProblem(""); }}>Form</button>
      <button type="button" aria-pressed={bulk} onClick={() => { setBulk(true); setProblem(""); }}>Spreadsheet</button>
    </div>{onPayment && <button type="button" className="button secondary" onClick={onPayment} disabled={working}><HandCoins size={16}/> Reimbursement payment</button>}</div>}
    {bulk ? <form className="entry-mode" key="bulk" onSubmit={saveRows} noValidate>
      <div className="bulk-help"><strong>Paste from Excel or Sheets</strong><p>Use account and category names from this sheet. Each row uses its account’s currency. Enter dates like 2026-11-07 or 07/11/2026. Use the person-plus button in an expense’s Reimbursement column to add several people.</p>
        <p>Use the arrow keys to move between cells. Press F2 to move the cursor within a cell. Drag a row by its grip, or open its row menu to move it or insert a row.</p>
        <p>Drag a cell’s corner up or down to fill. Shift-click for a range, or Ctrl/⌘-click to select individual cells in the same row. Ctrl/⌘+D copies from above, and Alt+Shift+↑ copies from below.</p></div>
      <div className="grid-scroll" ref={bindGrid} tabIndex={0} aria-label="Spreadsheet entry grid">
        <table className="entry-grid"><thead><tr><th scope="col">#</th>{columns.map(([key, label, hint]) => <th key={key} scope="col" className={"col-" + key} title={hint} aria-description={hint}>{label}</th>)}<th scope="col">Remove</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id} data-sheet-row={index}
            data-row-moving={rowMove?.source === row.id || undefined}
            data-row-drop={rowMove?.target === row.id && index !== movingRowIndex ? index < movingRowIndex ? "above" : "below" : undefined}><th scope="row">
            <span className="sheet-row-label">
              {rows.length > 1 && <span className="sheet-row-grip" title="Drag to move row" aria-hidden="true"
                onPointerDown={event => beginRowMove(event, row.id)} onPointerMove={previewRowMove}
                onPointerUp={finishRowMove} onPointerCancel={() => finishRowMove()} onLostPointerCapture={() => finishRowMove()}>
                <GripVertical size={15}/>
              </span>}
              <span>{index + 1}</span>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger type="button" className="icon-button" title="Row actions"
                  aria-label={"Actions for row " + (index + 1)} disabled={working}><ListPlus size={15} aria-hidden="true"/></DropdownMenu.Trigger>
                <DropdownMenu.Portal container={dialog ?? undefined}>
                  <DropdownMenu.Content className="picker-menu row-menu" sideOffset={6} align="start" collisionPadding={10}>
                    <DropdownMenu.Item className="picker-option" disabled={rows.length >= maxRows} onSelect={() => addRows(1, row.id)}>Insert row above</DropdownMenu.Item>
                    <DropdownMenu.Item className="picker-option" disabled={rows.length >= maxRows} onSelect={() => addRows(1, row.id, "below")}>Insert row below</DropdownMenu.Item>
                    <DropdownMenu.Item className="picker-option" disabled={index === 0} onSelect={() => moveRow(row.id, rows[index - 1].id)}>Move row up</DropdownMenu.Item>
                    <DropdownMenu.Item className="picker-option" disabled={index === rows.length - 1} onSelect={() => moveRow(row.id, rows[index + 1].id)}>Move row down</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </span>
          </th>
            {columns.map(([key, label], col) => {
              const error = rowErrors[row.id]?.[key];
              const cellSelected = selected?.row === row.id && selected.columns.includes(col);
              const monetary = key === "amount" || key === "reimbursable";
              const amountId = row.id + "/" + key;
              const splitButton = key === "reimbursable" && row.kind === "expense";
              const personCount = splitButton ? row.people?.filter(person => person.counterparty.trim()).length ?? 0 : 0;
              const splitLabel = (row.people ? "Edit split" : "Split by person") + " for row " + (index + 1);
              const splitCell = !!row.people && row.kind === "expense" && splitColumns.has(key);
              const destination = key === "destination_account_id";
              const unavailableDestination = destination && !hasDestination(row.kind);
              const disabled = splitCell || unavailableDestination;
              const text = disabled ? "" : cellText(row, key);
              const rowAccount = monetary ? workspace.accounts.find(account => account.id === row.account_id) : undefined;
              const display = monetary && editingAmount !== amountId ? formatMoneyInput(text, rowAccount ? accountCurrency(rowAccount) : currency) : text;
              return <td key={key} title={unavailableDestination ? "Available for transfers and investment movements." : undefined}
                data-selected={!disabled && cellSelected || undefined} data-fill={!disabled && fill && fill.columns.includes(col) && index >= Math.min(fill.start, fill.end) && index <= Math.max(fill.start, fill.end) || undefined}>
              <div className="sheet-cell"><input id={"cell-" + index + "-" + col} aria-label={"Row " + (index + 1) + ", " + label} aria-invalid={!!error && !disabled}
                aria-describedby={error && !disabled ? "error-" + index + "-" + col : undefined} value={display} disabled={disabled} required={requiredColumns.has(key) || (destination && !disabled)}
                inputMode={monetary ? "decimal" : undefined} onFocus={monetary ? () => setEditingAmount(amountId) : undefined}
                onChange={event => updateCell(row, key, event.target.value)}
                onBlur={event => {
                  editingCell.current = false;
                  if (monetary) { setEditingAmount(null); return; }
                  const value = event.target.value;
                  const next = fieldById.get(key)?.field_type === "number" ? groupNumber(value) : value;
                  if (next !== value) updateCell(row, key, next);
                }}
                onClick={event => selectCell(event, row.id, col)} onPaste={event => paste(event, index, col)} onKeyDown={event => advance(event, index, col)} />
              {splitButton && <button type="button" id={"sheet-split-" + row.id} className="cell-choice sheet-split-button"
                title={splitLabel} aria-label={splitLabel + (personCount ? ", " + personCount + (personCount === 1 ? " person" : " people") : "")}
                aria-expanded={splitRowId === row.id} aria-controls={splitRowId === row.id ? "sheet-split-editor" : undefined}
                onClick={() => openSplit(row)} disabled={working}>
                <UserRoundPlus size={15} aria-hidden="true"/>
                {personCount > 0 && <span className="sheet-split-count" aria-hidden="true">{personCount}</span>}
              </button>}
              {(!splitCell || splitButton) && <SpreadsheetChoice workspace={workspace} row={row} column={key} field={fieldById.get(key)} text={text}
                label={`Choose ${label} for row ${index + 1}`}
                choose={value => updateCell(row, key, value)} disabled={disabled}/>}
              {!disabled && rows.length > 1 && (cellSelected || text) && <button type="button" className="fill-handle" tabIndex={-1} aria-hidden="true"
                onPointerDown={event => beginFill(event, index, col)} onPointerMove={moveFill}
                onPointerUp={() => finishFill(true)} onPointerCancel={() => finishFill(false)} onLostPointerCapture={() => finishFill(false)}/>}</div>
              {error && !disabled && <small className="field-error" id={"error-" + index + "-" + col}>{error}</small>}
            </td>; })}
            <td><button type="button" className="icon-button" aria-label={"Remove row " + (index + 1)} disabled={rows.length < 2} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={16} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {splitRow && <section className="panel sheet-split-editor" id="sheet-split-editor" tabIndex={-1} aria-label={"Reimbursement split for row " + (splitIndex + 1)}>
        <div className="sheet-split-heading"><h3>Reimbursement split · Row {splitIndex + 1}</h3>
          <button className="button quiet" type="button" onClick={() => closeSplit(splitRow.id)}>Done</button>
        </div>
        <SplitShares workspace={workspace} draft={splitRow} setDraft={change => updateRow(splitRow, change)}
          currency={splitRow.account_id ? currencyForAccount(workspace, splitRow.account_id) : currency} errors={rowErrors[splitRow.id] ?? {}}/>
        <button className="button quiet" type="button" onClick={() => {
          updateRow(splitRow, row => ({ ...row, people: undefined })); closeSplit(splitRow.id);
        }}>Use single reimbursement</button>
      </section>}
      {earlyRows > 0 && <p className="history-note" role="status">{earlyRows} {earlyRows === 1 ? "row predates" : "rows predate"} an account’s tracking date. These rows appear in reports. Earlier amounts are excluded from the affected balances.</p>}
      <div className="bulk-add">
        <div className="row-actions" role="group" aria-label="Add spreadsheet rows">
          <button type="button" className="button quiet" onClick={() => addRows(1)} disabled={rows.length >= maxRows || working}><Plus size={16}/> Add row</button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger className="button quiet row-actions-menu" type="button" aria-label="Add multiple rows" disabled={rows.length > maxRows - 2 || working}><ChevronDown size={16} aria-hidden="true"/></DropdownMenu.Trigger>
            <DropdownMenu.Portal container={dialog ?? undefined}>
              <DropdownMenu.Content className="picker-menu row-menu" sideOffset={6} align="end" collisionPadding={10}>
                {[2, 5, 10, 25].map(count => <DropdownMenu.Item className="picker-option" key={count}
                  disabled={rows.length + count > maxRows} onSelect={() => addRows(count)}>Add {count} rows</DropdownMenu.Item>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {selected && selected.columns.length > 1 && <span className="sheet-selection-count" role="status">{selected.columns.length} cells selected</span>}
      </div>
      {problem && <p className="form-message error" role="alert"><CircleAlert size={17} />{problem}</p>}
      <div className="modal-footer">
        {splitRow && <small className="sheet-save-hint" id="sheet-save-hint" role="status">Choose Done in the split editor to enable saving.</small>}
        <button type="button" className="button secondary" onClick={onClose} disabled={working}>Cancel</button>
        <button className="button primary" disabled={working || !!splitRow} aria-describedby={splitRow ? "sheet-save-hint" : undefined}>{working ? "Saving…" : "Save all entries"}</button>
      </div>
    </form> : <form className="entry-mode" key="form" onSubmit={saveForm} noValidate>
      <EntryFields workspace={workspace} draft={draft} setDraft={setDraft} currency={currency} original={original}
        errors={errors} claim={claim} setClaim={setClaim}/>
      {problem && <p className="form-message error" role="alert"><CircleAlert size={17} />{problem}</p>}
      <div className="modal-footer">
        {original?.kind === "income" && onPayment && <button type="button" className="button secondary" onClick={onPayment} disabled={working}><HandCoins size={16}/> Link to reimbursement</button>}
        {original && onDelete && <button className="button danger quiet push" type="button" onClick={() => onDelete(original)} disabled={working}><Trash2 size={16} /> Delete</button>}
        <button type="button" className="button secondary" onClick={onClose} disabled={working}>Cancel</button>
        {!original && <button className="button secondary" type="submit" value="another" disabled={working}>Save and add another</button>}
        <button className="button primary" type="submit" disabled={working}>{working ? "Saving…" : "Save entry"}</button>
      </div>
    </form>}
  </Modal>;
}
