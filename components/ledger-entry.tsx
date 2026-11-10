"use client";

import { useCallback, useRef, useState, type CSSProperties, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronDown, CircleAlert, Plus, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  accountCurrency, activeFields, blankDraft, currencyForAccount, currencyLabel, draftFrom, editableAccounts, formatMoneyInput, groupNumber, historicalAccounts, kinds, needsDestination, parseDate, validateEntry, validateFormEntry, workspaceForCurrency,
  type Currency, type Entry, type EntryDraft, type Field as Definition, type Kind, type ReimbursementMode, type Workspace,
} from "@/lib/ledger";
import { Field, Modal } from "./ledger-ui";
import { DatePicker, Picker } from "./ledger-picker";

type Props = {
  workspace: Workspace; month: string; currency: Currency; original?: Entry; kind?: Kind; preset?: string; initialBulk?: boolean;
  onSave: (entries: Entry[]) => Promise<void>; onDelete?: (entry: Entry) => void; onClose: () => void;
};
const maxRows = 250;
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
function SpreadsheetChoice({ workspace, row, column, field, text, label, choose }: {
  workspace: Workspace; row: EntryDraft; column: string; field?: Definition; text: string; label: string; choose: (value: string) => void;
}) {
  if (column === "occurred_on" || column === "due_on" || field?.field_type === "date") {
    return <DatePicker compact label={label} value={parseDate(text) ?? ""} onChange={choose}
      min={column === "due_on" ? parseDate(row.occurred_on) ?? undefined : undefined} required={column === "occurred_on" || field?.required}/>;
  }
  let options: { value: string; label: string; swatch?: string }[] = [];
  if (column === "kind") options = Object.values(kinds).map(label => ({ value: label, label }));
  else if (column === "category_id") options = [
    { value: "", label: "Uncategorized" },
    ...workspace.categories.filter(category => !category.archived && category.applicable_kind === row.kind)
      .map(category => ({ value: category.name, label: category.name, swatch: category.color })),
  ];
  else if (column === "account_id" || column === "destination_account_id") {
    const destination = column === "destination_account_id";
    if (destination && !needsDestination(row.kind)) return <Picker compact label={label + " (transfers and investment movements only)"} options={[]} disabled/>;
    const source = workspace.accounts.find(account => account.id === row.account_id);
    options = editableAccounts(workspace, row.kind, destination)
      .filter(account => !destination || account.id !== row.account_id && (!source || accountCurrency(account) === accountCurrency(source)))
      .map(account => ({ value: account.name, label: account.name + " · " + accountCurrency(account) }));
    return <Picker compact label={options.length ? label : label + " (no eligible accounts)"} options={options} value={text} onValueChange={choose} disabled={!options.length}/>;
  } else if (field?.field_type === "select") options = field.options.map(label => ({ value: label, label }));
  else if (field?.field_type === "checkbox") options = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  return options.length ? <Picker compact label={label} options={options} value={text} onValueChange={choose}/> : null;
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

export function EntryFields({ workspace, draft, setDraft, currency, original, errors, claim, setClaim, lockCurrency }: {
  workspace: Workspace; draft: EntryDraft; setDraft: (update: (draft: EntryDraft) => EntryDraft) => void;
  currency: Currency; original?: Entry; errors: Record<string, string>; claim: ReimbursementMode; setClaim: (claim: ReimbursementMode) => void; lockCurrency?: boolean;
}) {
  const fields = activeFields(workspace);
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
          {(["none", "partial", "full"] as const).map((value, index) => <label key={value}>
            <input type="radio" value={value} checked={claim === value} onChange={() => setClaim(value)} name="reimbursement-mode"/>
            <span>{["None", "Partial", "Full"][index]}</span>
          </label>)}
        </fieldset>}
        {draft.kind === "expense" && claim !== "none" && <>
          <Field label={`Reimbursable amount (${unit})`} error={errors.reimbursable} hint={claim === "full" ? "Matches the full expense amount." : undefined}>
            <input value={claim === "full" ? draft.amount : draft.reimbursable} readOnly={claim === "full"} aria-invalid={!!errors.reimbursable} inputMode="decimal" placeholder="0"
              onBlur={() => { if (claim === "partial") set("reimbursable", formatMoneyInput(draft.reimbursable, entryCurrency)); }} onChange={event => set("reimbursable", event.target.value)}/>
          </Field>
          <Field label="Owed by" error={errors.counterparty}><input value={draft.counterparty} aria-invalid={!!errors.counterparty} onChange={event => set("counterparty", event.target.value)} /></Field>
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

export function EntryDialog({ workspace, month, currency, original, kind, preset, initialBulk, onSave, onDelete, onClose }: Props) {
  const make = () => {
    const scope = workspaceForCurrency(workspace, preset ? currencyForAccount(workspace, preset) : currency);
    return blankDraft(scope.accounts.length ? scope : workspace, month, kind, preset);
  };
  const originalCurrency = original ? currencyForAccount(workspace, original.account_id) : currency;
  const [draft, setDraft] = useState(() => original ? draftFrom(original, originalCurrency) : make());
  const [bulk, setBulk] = useState(!!initialBulk);
  const makeRow = () => ({ ...make(), occurred_on: "", kind: "", account_id: "", destination_account_id: null });
  const [rows, setRows] = useState<EntryDraft[]>(() => [makeRow()]);
  const [selected, setSelected] = useState<{ row: string; anchor: number; columns: number[] } | null>(null);
  const [fill, setFill] = useState<{ start: number; end: number; columns: number[] } | null>(null);
  const dragFill = useRef<typeof fill>(null);
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
  const [claim, setClaim] = useState<ReimbursementMode>(() => original?.reimbursable_minor
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
    ["reimbursable", "Reimbursement (optional)", "Portion of the expense that someone owes you back."],
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
      const checkbox = field.field_type === "checkbox";
      const next = checkbox ? /^(true|yes|1|checked|x)$/i.test(value.trim()) : value;
      return { ...row, custom: { ...row.custom, [key]: next } };
    }
    if (key === "kind") return changeKind(workspace, row, kindMatch(value));
    if (key === "account_id" || key === "destination_account_id") return { ...row, [key]: match(value, workspace.accounts) };
    if (key === "category_id") return { ...row, category_id: match(value, workspace.categories.filter(category => category.applicable_kind === row.kind)) || null };
    return { ...row, [key]: value };
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
    setProblem(""); setRowErrors({});
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
  function fillDown(start: number, end: number, selectedColumns: number[]) {
    if (end <= start) return;
    const keys = selectedColumns.toSorted((a, b) => a - b).map(column => columns[column][0]);
    setRows(current => {
      const source = current[start];
      if (!source) return current;
      const cells = keys.map(key => [key, cellText(source, key)] as const);
      return current.map((row, index) => index > start && index <= end
        ? cells.reduce((next, [key, value]) => assign(next, key, value), row) : row);
    });
    setRowErrors({});
  }
  function beginFill(event: PointerEvent<HTMLButtonElement>, start: number, column: number) {
    if (working || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selectedColumns = selected?.row === rows[start].id && selected.columns.includes(column) ? selected.columns : [column];
    dragFill.current = { start, end: start, columns: selectedColumns };
    setFill(dragFill.current);
  }
  function moveFill(event: PointerEvent<HTMLButtonElement>) {
    const selection = dragFill.current;
    if (!selection || !grid.current) return;
    const area = grid.current.getBoundingClientRect();
    if (event.clientY > area.bottom - 24) grid.current.scrollTop += 16;
    const row = document.elementFromPoint(Math.min(area.right - 4, Math.max(area.left + 4, event.clientX)),
      Math.min(area.bottom - 4, Math.max(area.top + 4, event.clientY)))?.closest<HTMLElement>("tr[data-sheet-row]");
    const end = row ? Math.max(selection.start, Number(row.dataset.sheetRow)) : selection.end;
    if (end === selection.end) return;
    dragFill.current = { ...selection, end };
    setFill(dragFill.current);
  }
  function finishFill(commit: boolean) {
    const selection = dragFill.current;
    dragFill.current = null;
    setFill(null);
    if (selection && commit) fillDown(selection.start, selection.end, selection.columns);
  }
  function addRows(count: number) {
    setRows(current => [...current, ...Array.from({ length: Math.min(count, maxRows - current.length) }, makeRow)]);
  }
  function advance(event: KeyboardEvent<HTMLInputElement>, index: number, col: number) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && index > 0) {
      event.preventDefault();
      const selectedColumns = selected?.row === rows[index].id && selected.columns.includes(col) ? selected.columns : [col];
      fillDown(index - 1, index, selectedColumns);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = document.querySelector<HTMLInputElement>('#cell-' + (index + 1) + '-' + col);
    if (next) next.focus();
    else if (rows.length < maxRows) {
      addRows(1);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#cell-' + (index + 1) + '-' + col)?.focus());
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
    if (working) return;
    const filled = rows.filter(row => row.description.trim() || row.amount.trim() || row.notes.trim() || row.reimbursable.trim() || row.counterparty.trim() || Object.values(row.custom).some(Boolean));
    if (!filled.length) { setProblem("Enter at least one row to save."); return; }
    const parsed = filled.map(row => [row.id, validateEntry(workspace, row)] as const);
    const invalid = Object.fromEntries(parsed.flatMap(([id, result]) => result.errors ? [[id, result.errors]] : []));
    setRowErrors(invalid);
    if (Object.keys(invalid).length) {
      setProblem("Review the highlighted cells. No rows were saved.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('dialog [aria-invalid="true"]')?.focus());
      return;
    }
    setProblem(""); setWorking(true);
    try { await onSave(parsed.flatMap(([, result]) => result.entry ? [result.entry] : [])); onClose(); }
    catch (error) { setProblem(error instanceof Error ? error.message : "The rows could not be saved."); }
    finally { setWorking(false); }
  }
  return <Modal title={original ? "Edit entry" : "Add entries"} subtitle={original ? "Update the details in your ledger." : "Choose how to enter your transactions."} onClose={onClose} wide={bulk} locked={working}>
    {!original && <div className="mode-switch segmented" style={{ "--selection": bulk ? 1 : 0 } as CSSProperties} role="group" aria-label="Entry mode">
      <button type="button" aria-pressed={!bulk} onClick={() => { setBulk(false); setProblem(""); }}>Form</button>
      <button type="button" aria-pressed={bulk} onClick={() => { setBulk(true); setProblem(""); }}>Spreadsheet</button>
    </div>}
    {bulk ? <form className="entry-mode" key="bulk" onSubmit={saveRows} noValidate>
      <div className="bulk-help"><strong>Paste from Excel or Sheets</strong><p>Use account and category names from this sheet. Each row uses its account’s currency. Enter dates like 2026-11-07 or 07/11/2026.</p>
        <p>Add rows, then drag a cell’s corner to fill down. Shift-click for a range, or Ctrl/⌘-click to select individual cells in the same row. Ctrl/⌘+D copies from the row above.</p></div>
      <div className="grid-scroll" ref={bindGrid} tabIndex={0} aria-label="Spreadsheet entry grid">
        <table className="entry-grid"><thead><tr><th scope="col">#</th>{columns.map(([key, label, hint]) => <th key={key} scope="col" className={"col-" + key} title={hint} aria-description={hint}>{label}</th>)}<th scope="col">Remove</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id} data-sheet-row={index}><th scope="row">{index + 1}</th>
            {columns.map(([key, label], col) => {
              const error = rowErrors[row.id]?.[key];
              const cellSelected = selected?.row === row.id && selected.columns.includes(col);
              return <td key={key} data-selected={cellSelected || undefined} data-fill={fill && fill.columns.includes(col) && index >= fill.start && index <= fill.end || undefined}>
              <div className="sheet-cell"><input id={"cell-" + index + "-" + col} aria-label={"Row " + (index + 1) + ", " + label} aria-invalid={!!error}
                aria-describedby={error ? "error-" + index + "-" + col : undefined} value={cellText(row, key)}
                inputMode={key === "amount" || key === "reimbursable" ? "decimal" : undefined}
                onChange={event => { const value = event.target.value; setRows(current => current.map(item => item.id === row.id ? assign(item, key, value) : item)); }}
                onBlur={event => {
                  const value = event.target.value;
                  const next = (key === "amount" || key === "reimbursable") && workspace.accounts.some(account => account.id === row.account_id) ? formatMoneyInput(value, currencyForAccount(workspace, row.account_id))
                    : fieldById.get(key)?.field_type === "number" ? groupNumber(value) : value;
                  if (next !== value) setRows(current => current.map(item => item.id === row.id ? assign(item, key, next) : item));
                }}
                onClick={event => selectCell(event, row.id, col)} onPaste={event => paste(event, index, col)} onKeyDown={event => advance(event, index, col)} />
              <SpreadsheetChoice workspace={workspace} row={row} column={key} field={fieldById.get(key)} text={cellText(row, key)}
                label={`Choose ${label} for row ${index + 1}`}
                choose={value => setRows(current => current.map(item => item.id === row.id ? assign(item, key, value) : item))}/>
              {index < rows.length - 1 && (cellSelected || cellText(row, key)) && <button type="button" className="fill-handle" tabIndex={-1} aria-hidden="true"
                onPointerDown={event => beginFill(event, index, col)} onPointerMove={moveFill}
                onPointerUp={() => finishFill(true)} onPointerCancel={() => finishFill(false)} onLostPointerCapture={() => finishFill(false)}/>}</div>
              {error && <small className="field-error" id={"error-" + index + "-" + col}>{error}</small>}
            </td>; })}
            <td><button type="button" className="icon-button" aria-label={"Remove row " + (index + 1)} disabled={rows.length < 2} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={16} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
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
      <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose} disabled={working}>Cancel</button><button className="button primary" disabled={working}>{working ? "Saving…" : "Save all entries"}</button></div>
    </form> : <form className="entry-mode" key="form" onSubmit={saveForm} noValidate>
      <EntryFields workspace={workspace} draft={draft} setDraft={setDraft} currency={currency} original={original}
        errors={errors} claim={claim} setClaim={setClaim}/>
      {problem && <p className="form-message error" role="alert"><CircleAlert size={17} />{problem}</p>}
      <div className="modal-footer">
        {original && onDelete && <button className="button danger quiet push" type="button" onClick={() => onDelete(original)} disabled={working}><Trash2 size={16} /> Delete</button>}
        <button type="button" className="button secondary" onClick={onClose} disabled={working}>Cancel</button>
        {!original && <button className="button secondary" type="submit" value="another" disabled={working}>Save and add another</button>}
        <button className="button primary" type="submit" disabled={working}>{working ? "Saving…" : "Save entry"}</button>
      </div>
    </form>}
  </Modal>;
}
