"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FileText, Sparkles, Square, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { accountCurrency, money, parseMoney, validateFormEntry, type Entry, type EntryDraft, type ReimbursementMode, type Workspace } from "@/lib/ledger";
import { type ChatMessage, type DraftPreview, type ReportEvidence, type Statement } from "@/lib/ai-contract";
import { statementChecks } from "@/lib/ai-finance";
import { demoActions, SAMPLE_PDF_NAME, type DemoAction, type DemoResult } from "@/lib/ai-demo";
import { EntryFields } from "./ledger-entry";

type Message = ChatMessage & { id: string; evidence?: ReportEvidence[]; recorded?: boolean };
const modeFor = (p: DraftPreview): ReimbursementMode => p.draft.people?.length ? "split" : !p.draft.reimbursable ? "none" : parseMoney(p.draft.reimbursable, p.currency) === parseMoney(p.draft.amount, p.currency) ? "full" : "partial";
const evidenceLabel = (key: string) => ({ gross: "Gross expenses", spending: "Personal spending", cash: "Cash balance", invested: "Investment value", collected: "Reimbursements received", contribution: "Investment contributions", withdrawal: "Investment withdrawals", receivable: "Outstanding reimbursements" }[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "));
const visibleKey = (key: string) => key !== "id" && !key.endsWith("_id") && !key.endsWith("_minor") && key !== "minor" && key !== "custom_values";
function evidenceText(value: unknown): string | null {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object" && "formatted" in value && typeof value.formatted === "string") return value.formatted;
  return null;
}
function EvidenceValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const text = evidenceText(value);
  if (text !== null) return <span>{text}</span>;
  if (depth > 6) return <span>See the saved records for more details.</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span>None recorded</span>;
    const rows = value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(visibleKey);
    if (rows.length === value.length && keys.length && rows.every(row => keys.every(key => evidenceText(row[key]) !== null))) return <div className="assistant-evidence-table"><table><thead><tr>{keys.map(key => <th key={key}>{evidenceLabel(key)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{keys.map(key => <td key={key}>{evidenceText(row[key])}</td>)}</tr>)}</tbody></table></div>;
    return <div className="assistant-evidence-list">{value.map((item, i) => <EvidenceValue key={i} value={item} depth={depth + 1}/>)}</div>;
  }
  if (value && typeof value === "object") return <dl className="assistant-evidence-values">{Object.entries(value).filter(([key]) => visibleKey(key)).map(([key, item]) => <div key={key}><dt>{evidenceLabel(key)}</dt><dd><EvidenceValue value={item} depth={depth + 1}/></dd></div>)}</dl>;
  return null;
}
function Evidence({ evidence }: { evidence: ReportEvidence[] }) {
  return <div className="assistant-evidence">{evidence.map(item => <details key={item.id}><summary>[{item.id}] {item.title}</summary><p>Calculated from the original fixed fictional sample ledger.</p><EvidenceValue value={item.data}/></details>)}</div>;
}
export function DemoEntryAssistant({ workspace, onSave }: {
  workspace: Workspace; onSave: (entries: Entry[]) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [serverState, setServerState] = useState<string>();
  const [dinnerDraft, setDinnerDraft] = useState(false);
  const [previews, setPreviews] = useState<DraftPreview[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claims, setClaims] = useState<Record<string, ReimbursementMode>>({});
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [messages, working]);
  useEffect(() => () => controller.current?.abort(), []);
  const checks = statementChecks(previews, statement);
  const needsAcknowledgement = checks.some(check => !check.ok);
  const locked = working || saving;
  async function send(action: DemoAction) {
    if (busy.current || locked) return;
    busy.current = true; setWorking(true); setProblem("");
    const abort = new AbortController(); controller.current = abort;
    try {
      // Deliberately send only a scenario ID and server-signed context. Never send local records or edits.
      const response = await fetch("/api/ai-demo", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ action, state: serverState }) });
      const result = await response.json() as DemoResult & { error?: string };
      if (!response.ok) throw Error(result.error || "The demo could not complete this request.");
      setServerState(result.state);
      const user: Message = { id: crypto.randomUUID(), role: "user", text: result.userText,
        ...(result.sampleAttached ? { attachments: [{ name: SAMPLE_PDF_NAME, type: "application/pdf", data: "" }] } : {}) };
      setMessages(current => [...current, user, { id: crypto.randomUUID(), role: "assistant", text: result.text, evidence: result.evidence }]);
      if (result.previews !== null) {
        setPreviews(result.previews); setStatement(result.statement); setAcknowledged(false);
        setSelected(new Set(result.previews.filter(p => !p.duplicates.length).map(p => p.draft.id)));
        setClaims(Object.fromEntries(result.previews.map(p => [p.draft.id, modeFor(p)])));
        setDinnerDraft(action === "dinner" || action === "correction");
      }
    } catch (error) { setProblem(abort.signal.aborted ? "Request stopped. No records were saved." : error instanceof Error ? error.message : "The demo could not respond. Try again."); }
    finally { busy.current = false; setWorking(false); controller.current = null; }
  }
  async function loadRecordedExample() {
    if (busy.current || locked) return;
    busy.current = true; setWorking(true); setProblem("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/ai-demo-recorded-example.json", { signal: abort.signal });
      if (!response.ok) throw Error("The recorded example could not be loaded.");
      const example = await response.json() as Pick<DemoResult, "text" | "previews" | "statement">;
      const rows = (example.previews ?? []).map(p => ({ ...p, draft: { ...p.draft, id: crypto.randomUUID() }, duplicates: [] }));
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text: "Show the recorded Gemini PDF example." },
        { id: crypto.randomUUID(), role: "assistant", text: example.text, recorded: true }]);
      setPreviews(rows); setStatement(example.statement); setServerState(undefined); setDinnerDraft(false); setAcknowledged(false);
      setSelected(new Set(rows.map(p => p.draft.id))); setClaims(Object.fromEntries(rows.map(p => [p.draft.id, modeFor(p)])));
    } catch (error) { setProblem(error instanceof Error ? error.message : "Could not load the recorded example."); }
    finally { busy.current = false; setWorking(false); controller.current = null; }
  }
  function edit(id: string, update: (draft: EntryDraft) => EntryDraft) {
    setPreviews(current => current.map(p => p.draft.id === id ? { ...p, draft: update(p.draft), errors: {} } : p));
    setAcknowledged(false); setProblem("");
  }
  function reset() {
    if (locked) return;
    setMessages([]); setPreviews([]); setStatement(null); setServerState(undefined); setDinnerDraft(false); setSelected(new Set()); setClaims({}); setProblem(""); setAcknowledged(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy.current || locked || !selected.size) return;
    if (needsAcknowledgement && !acknowledged) { setProblem("Review the statement discrepancies and acknowledge them before submitting."); return; }
    const entries: Entry[] = []; let invalid = false;
    const next = previews.map(p => {
      if (!selected.has(p.draft.id)) return p;
      const result = validateFormEntry(workspace, p.draft, claims[p.draft.id] ?? "none");
      const errors = { ...result.errors }; const account = workspace.accounts.find(a => a.id === p.draft.account_id);
      if (account && accountCurrency(account) !== p.currency) errors.account_id = "Choose an account in this entry’s currency.";
      if (result.entry && !Object.keys(errors).length) entries.push(result.entry); else invalid = true;
      return { ...p, errors };
    });
    setPreviews(next);
    if (invalid) {
      setProblem("Fix the highlighted details in the selected entries before submitting.");
      requestAnimationFrame(() => { form.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(d => { d.open = true; }); form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }); return;
    }
    const signature = (e: Entry) => [e.account_id, e.occurred_on, e.kind, e.amount_minor, e.description.trim().toLocaleLowerCase()].join("|");
    const seen = new Set(workspace.transactions.map(signature)); const duplicateIds = new Set<string>();
    for (const entry of entries) { const key = signature(entry); if (seen.has(key)) duplicateIds.add(entry.id); seen.add(key); }
    const newlyFlagged = next.filter(p => duplicateIds.has(p.draft.id) && !p.duplicates.length);
    if (newlyFlagged.length) {
      setPreviews(next.map(p => duplicateIds.has(p.draft.id) ? { ...p, duplicates: p.duplicates.length ? p.duplicates : ["matching entry"] } : p));
      setSelected(current => new Set([...current].filter(id => !newlyFlagged.some(p => p.draft.id === id))));
      setProblem("Possible duplicates were deselected. Review them; select them explicitly if they are separate real transactions."); return;
    }
    busy.current = true; setSaving(true); setProblem("");
    try {
      await onSave(entries);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Added ${entries.length} reviewed ${entries.length === 1 ? "entry" : "entries"} to the browser-only fictional review ledger. No database records were written.` }]);
      setPreviews(current => current.filter(p => !selected.has(p.draft.id))); setSelected(new Set()); setStatement(null); setDinnerDraft(false);
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn’t save these entries. Your previews are still available."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="assistant-layout ai-layout">
    <section className="panel assistant-chat" aria-label="Finance AI chat">
      <header><span className="glyph" data-tone="orchid"><Sparkles size={19}/></span><div><h2>Live AI demo</h2><p>Explore fictional examples with Gemini.</p></div>
        <button type="button" className="icon-button" disabled={locked} onClick={reset} title={previews.length ? "Discard drafts and start a new chat" : "New chat"} aria-label={previews.length ? "Discard drafts and start a new chat" : "New chat"}><Trash2 size={17}/></button></header>
      <div className="assistant-thread" role="log" aria-label="Conversation" ref={thread}>
        <div className="assistant-bubble"><p>Choose a sample conversation below. I can summarize the fictional ledger, read the included sample PDF, and prepare editable entries. Live scenarios generate replies with Gemini. The optional recorded example is labeled separately.</p>
        </div>
        {messages.map(message => <div key={message.id} className={"assistant-bubble " + (message.role === "user" ? "you" : "")}><span className="sr-only">{message.role === "user" ? "You" : "Assistant"} </span>
          {message.recorded && <p className="pill amber">Recorded Gemini example · not a live response</p>}
          <div className="assistant-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{message.text}</Markdown></div>
          {message.attachments?.map((file, index) => <p className="assistant-file" key={index}><FileText size={14}/>{file.name}</p>)}
          {!!message.evidence?.length && <Evidence evidence={message.evidence}/>}</div>)}
        {working && <p className="assistant-bubble" role="status">Preparing the demo response…</p>}
      </div>
      <div className="assistant-input-area">
        <p className="assistant-privacy">Fictional scenarios only. Google Gemini processes the fixed sample prompts, records and PDF. Your private ledger, uploaded files and review edits are never sent. Reports use the original sample ledger. <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></p>
        <div className="assistant-starters" aria-label="Choose a fictional AI scenario">{Object.entries(demoActions).map(([id, action]) => <button type="button" className="button secondary" key={id} disabled={locked || id === "correction" && !dinnerDraft} onClick={() => void send(id as DemoAction)}>{action.label}</button>)}</div>
        <p className="assistant-privacy">Starting another statement or dinner scenario replaces the current draft batch. The recorded PDF example works without live API quota; its source is <a href="/fictional-statement.pdf" target="_blank" rel="noreferrer">this fictional PDF</a>.</p>
        <div className="button-line"><button className="button quiet" type="button" disabled={locked} onClick={() => void loadRecordedExample()}>View recorded PDF example</button><a className="button quiet" href={"/" + SAMPLE_PDF_NAME} target="_blank" rel="noreferrer">Open sample PDF</a>{working && <button type="button" className="button quiet" onClick={() => controller.current?.abort()}><Square size={15}/>Stop response</button>}</div>
        {problem && <p className="form-message error" role="alert">{problem}</p>}
      </div>
    </section>
    {previews.length ? <form ref={form} className="panel assistant-preview ai-preview" onSubmit={submit} noValidate>
      <header><div><h2>Review {previews.length} {previews.length === 1 ? "entry" : "entries"}</h2><p>Edit the fictional examples, then submit to this tab’s review ledger. Edits stay in your browser.</p></div><span className="pill amber">Draft</span></header>
      {!!checks.length && <div className="assistant-reconciliation"><h3>Statement checks</h3>{checks.map(check => <p key={check.label} className={check.ok ? "" : "form-message error"}><strong>{check.ok ? "✓" : "!"} {check.label}</strong><br/>{check.detail}</p>)}
        {needsAcknowledgement && <label><input type="checkbox" checked={acknowledged} disabled={locked} onChange={e => setAcknowledged(e.target.checked)}/> I checked these differences against the statement and want to save the selected entries.</label>}</div>}
      <div className="assistant-batch-actions"><button className="button quiet" type="button" disabled={locked} onClick={() => setSelected(new Set(previews.filter(p => !p.duplicates.length).map(p => p.draft.id)))}>Select non-duplicates</button><button className="button quiet" type="button" disabled={locked} onClick={() => setSelected(new Set())}>Deselect all</button></div>
      {previews.map((preview, index) => { const id = preview.draft.id; const amount = parseMoney(preview.draft.amount, preview.currency);
        return <div className="assistant-draft" key={id}><label className="assistant-select-row"><input type="checkbox" checked={selected.has(id)} disabled={locked} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(id); else next.delete(id); return next; })}/><span><strong>{index + 1}. {preview.draft.description || "Untitled entry"}</strong><small>{preview.draft.occurred_on || "Date needed"} · {amount === null ? "Amount needed" : money(amount, preview.currency)}</small></span></label>
          {!!preview.duplicates.length && <p className="form-message error">Possible duplicate. Select only if this is a separate transaction.</p>}
          {preview.warnings.map((warning, n) => <p className="history-note" key={n}>{warning}</p>)}
          {!!Object.keys(preview.errors).length && <p className="form-message error">Review: {Object.values(preview.errors).join(" ")}</p>}
          {preview.source && <blockquote className="assistant-source"><strong>{preview.source.filename}{preview.source.page ? ` · page ${preview.source.page}` : ""}</strong><p>{preview.source.quote}</p></blockquote>}
          <details open={previews.length === 1 || undefined}><summary>Edit entry details</summary><fieldset disabled={locked}><EntryFields workspace={workspace} draft={preview.draft} setDraft={update => edit(id, update)} currency={preview.currency} errors={preview.errors} claim={claims[id] ?? "none"} setClaim={mode => { setClaims(current => ({ ...current, [id]: mode })); setAcknowledged(false); }} lockCurrency/></fieldset></details>
        </div>;
      })}
      <div className="button-line"><button type="button" className="button quiet" disabled={locked} onClick={() => { setPreviews([]); setStatement(null); setSelected(new Set()); setDinnerDraft(false); }}>Discard drafts</button><button type="submit" className="button primary" disabled={locked || !selected.size}><Check size={17}/>{saving ? "Saving…" : `Submit ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`}</button></div>
    </form> : <section className="panel assistant-preview assistant-empty"><h2>Your review area</h2><p>Transaction drafts from chat or statements will appear here. Questions and summaries use the original fictional sample ledger. Review edits and submissions stay in this browser tab.</p></section>}
  </div>;
}
