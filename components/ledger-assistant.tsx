"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Check, ClipboardCheck, Download, FileText, KeyRound, Paperclip, SlidersHorizontal, Sparkles, Square, Trash2, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { accountCurrency, money, parseMoney, validateFormEntry, workspaceForBook, type Currency, type Entry, type EntryDraft, type ReimbursementMode, type Workspace } from "@/lib/ledger";
import { MAX_UPLOAD_BYTES, previewForModel, reportDownloadSchema, type AssistantResult, type Attachment, type ChatMessage, type DraftPreview, type ReportEvidence, type Statement } from "@/lib/ai-contract";
import type { WorkspacePreview } from "@/lib/ai-workspace";
import { prepareStatementDownload } from "@/lib/statement";
import { statementChecks } from "@/lib/ai-finance";
import type { CloudConfig } from "@/lib/ledger-cloud-config";
import { getSupabase } from "@/lib/ledger-cloud";
import { EntryFields } from "./ledger-entry";
import { aiProviders, type PersonalAIConfig } from "@/lib/ai-provider-config";
import { AssistantAISettings } from "./assistant-ai-settings";

type DownloadFile = { url: string; filename: string };
type Message = ChatMessage & { id: string; evidence?: ReportEvidence[]; downloads?: DownloadFile[] };
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
  return <div className="assistant-evidence">{evidence.map(item => <details key={item.id}><summary>[{item.id}] {item.title}</summary><p>Calculated from saved records for this request.</p><EvidenceValue value={item.data}/></details>)}</div>;
}
export function EntryAssistant({ workspace, reportWorkspace, currency, cloud, sheetId, ownerId, personalAI, onPersonalAIChange, onSave, onSaveChange }: {
  workspace: Workspace; reportWorkspace: Workspace; currency: Currency; cloud: CloudConfig | null; sheetId: string; onSave: (entries: Entry[]) => Promise<void>; onSaveChange: (preview: WorkspacePreview) => Promise<void>;
  ownerId: string | null; personalAI: PersonalAIConfig | null; onPersonalAIChange: (config: PersonalAIConfig | null) => void;
}) {
  const [showAISettings, setShowAISettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [previews, setPreviews] = useState<DraftPreview[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claims, setClaims] = useState<Record<string, ReimbursementMode>>({});
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [changes, setChanges] = useState<WorkspacePreview[]>([]);
  const downloadUrls = useRef<string[]>([]);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [messages, working]);
  useEffect(() => () => { controller.current?.abort(); downloadUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const checks = statementChecks(previews, statement);
  const needsAcknowledgement = checks.some(check => !check.ok);
  const locked = working || saving || reading;
  const providerName = personalAI ? aiProviders[personalAI.provider].label : "Google Gemini";
  async function attach(incoming: FileList | null) {
    if (!incoming || locked) return;
    setReading(true); setProblem("");
    try {
      const existing = [...messages.flatMap(m => m.attachments ?? []), ...files];
      if (existing.reduce((n, f) => n + Math.ceil(f.data.length * 3 / 4), 0) + [...incoming].reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES || existing.length + incoming.length > 5) throw Error("Attach up to 5 files and 3 MB total per chat. Start a new chat for more files.");
      const attachments: Attachment[] = [];
      for (const file of incoming) {
        const type = file.type || (/\.csv$/i.test(file.name) ? "text/csv" : /\.txt$/i.test(file.name) ? "text/plain" : "");
        if (!["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"].includes(type)) throw Error("Choose a PDF, PNG, JPEG, CSV or text file.");
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        attachments.push({ name: file.name.slice(0, 160), type: type as Attachment["type"], data: btoa(binary) });
      }
      setFiles(current => [...current, ...attachments]);
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn’t attach this file."); }
    finally { setReading(false); if (upload.current) upload.current.value = ""; }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy.current || locked || !cloud || (!prompt.trim() && !files.length)) return;
    if (messages.length >= 28) { setProblem("This chat is full. Submit or discard drafts, then start a new chat."); return; }
    busy.current = true; setWorking(true); setProblem("");
    const user: Message = { id: crypto.randomUUID(), role: "user", text: prompt.trim() || "Read this statement and prepare an editable transaction preview.", attachments: files };
    const conversation = [...messages, user];
    const abort = new AbortController(); controller.current = abort;
    try {
      const { data: { session }, error } = await getSupabase(cloud).auth.getSession();
      if (error || !session || session.user.id !== ownerId) throw Error("Your sign-in changed. Reload before using the assistant.");
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, signal: abort.signal,
        body: JSON.stringify({ ...(personalAI ? { personalAI } : {}), messages: conversation.map(({ role, text, attachments }) => ({ role, text, attachments })), sheet_id: sheetId, currency,
          previews: previews.map(p => previewForModel({ ...p, draft: { ...p.draft, people: claims[p.draft.id] === "split" ? p.draft.people : undefined,
            reimbursable: claims[p.draft.id] === "none" ? "" : claims[p.draft.id] === "full" ? p.draft.amount : p.draft.reimbursable } })), statement }) });
      const result = await response.json() as AssistantResult & { error?: string };
      if (!response.ok) throw Error(result.error || "The assistant could not complete this request.");
      const assistantId = crypto.randomUUID();
      setMessages([...conversation, { id: assistantId, role: "assistant", text: result.text, evidence: result.evidence }]);
      setPrompt(""); setFiles([]);
      if (result.changes?.length) setChanges(current => [...current, ...result.changes!]);
      if (result.previews !== null) {
        setPreviews(result.previews); setStatement(result.statement); setAcknowledged(false);
        setSelected(new Set(result.previews.filter(p => !p.duplicates.length).map(p => p.draft.id)));
        setClaims(Object.fromEntries(result.previews.map(p => [p.draft.id, modeFor(p)])));
      }
      const downloads: DownloadFile[] = [];
      for (const requested of result.downloads ?? []) {
        const spec = reportDownloadSchema.parse(requested);
        if (spec.sheet_id && !reportWorkspace.finance_books.some(book => book.id === spec.sheet_id)) throw Error("That report sheet is no longer available. Ask for the report again.");
        const scoped = spec.scope === "all" ? reportWorkspace : workspaceForBook(reportWorkspace, spec.sheet_id ?? sheetId);
        const label = spec.scope === "all" ? "All sheets" : reportWorkspace.finance_books.find(b => b.id === (spec.sheet_id ?? sheetId))?.name ?? "Personal";
        const file = await prepareStatementDownload(scoped, spec.period, spec.currency, false, spec.kind, label);
        if (abort.signal.aborted) throw new DOMException("Request stopped", "AbortError");
        const url = URL.createObjectURL(file.blob); downloadUrls.current.push(url);
        downloads.push({ url, filename: file.filename });
      }
      if (downloads.length) {
        setMessages(current => current.map(message => message.id === assistantId ? { ...message, downloads } : message));
        for (const file of downloads) { const link = document.createElement("a"); link.href = file.url; link.download = file.filename; document.body.appendChild(link); link.click(); link.remove(); }
      }
    } catch (error) { setProblem(abort.signal.aborted ? "Request stopped. No entries were saved." : error instanceof Error ? error.message : "The assistant could not respond. Try again."); }
    finally { busy.current = false; setWorking(false); controller.current = null; }
  }
  function edit(id: string, update: (draft: EntryDraft) => EntryDraft) {
    setPreviews(current => current.map(p => p.draft.id === id ? { ...p, draft: update(p.draft), errors: {} } : p));
    setAcknowledged(false); setProblem("");
  }
  function reset() {
    if (locked) return;
    setMessages([]); setPreviews([]); setStatement(null); setPrompt(""); setFiles([]); setSelected(new Set()); setClaims({}); setProblem(""); setAcknowledged(false);
    setChanges([]); downloadUrls.current.forEach(url => URL.revokeObjectURL(url)); downloadUrls.current = [];
  }
  async function approveChange(preview: WorkspacePreview) {
    if (busy.current || locked) return;
    busy.current = true; setSaving(true); setProblem("");
    try {
      await onSaveChange(preview);
      setChanges(current => current.filter(item => item.id !== preview.id));
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Confirmed: ${preview.title}. The change is saved to your account and will be included when I next check your records.` }]);
    } catch (error) { setProblem(error instanceof Error ? error.message : "The change could not be saved. Your preview is still available."); }
    finally { busy.current = false; setSaving(false); }
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
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Saved ${entries.length} reviewed ${entries.length === 1 ? "entry" : "entries"} to this sheet.` }]);
      setPreviews(current => current.filter(p => !selected.has(p.draft.id))); setSelected(new Set()); setStatement(null);
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn’t save these entries. Your previews are still available."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="assistant-page">
    <div className="assistant-connection"><span>{personalAI ? <KeyRound size={16} aria-hidden="true"/> : <Sparkles size={16} aria-hidden="true"/>}<strong>{personalAI ? providerName : "Finance Studio AI"}</strong><span className="assistant-connection-detail">{personalAI ? `${personalAI.model} · Your key` : "Included Gemini connection"}</span></span>
      <button type="button" className="button secondary" disabled={locked || !cloud} onClick={() => setShowAISettings(true)}><SlidersHorizontal size={16} aria-hidden="true"/>AI settings</button></div>
    {showAISettings && <AssistantAISettings config={personalAI} onChange={onPersonalAIChange} onClose={() => setShowAISettings(false)}/>}
    <div className="assistant-layout ai-layout">
    <section className="panel assistant-chat" aria-label="Finance AI chat">
      <header><span className="glyph" data-tone="orchid"><Sparkles size={19}/></span><div><h2>Finance assistant</h2><p>Your records, with a little help.</p></div>
        <button type="button" className="icon-button" disabled={locked} onClick={reset} title={previews.length ? "Discard drafts and start a new chat" : "New chat"} aria-label={previews.length ? "Discard drafts and start a new chat" : "New chat"}><Trash2 size={17}/></button></header>
      <div className="assistant-thread" role="log" aria-label="Conversation" ref={thread}>
        <div className="assistant-bubble"><p>Ask me to summarize your finances from the first recorded day, find a payment, or read a bank statement. I’ll prepare entries for you to review before saving.</p>
          <div className="assistant-starters">{["Summarize all my finances from the first recorded day across all sheets.", "Show my largest expenses this month."].map(text => <button className="button quiet" type="button" key={text} disabled={locked || !cloud} onClick={() => setPrompt(text)}>{text}</button>)}</div></div>
        {messages.map(message => <div key={message.id} className={"assistant-bubble " + (message.role === "user" ? "you" : "")}><span className="sr-only">{message.role === "user" ? "You" : "Assistant"} </span>
          <div className="assistant-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{message.text}</Markdown></div>
          {message.attachments?.map((file, index) => <p className="assistant-file" key={index}><FileText size={14}/>{file.name}</p>)}
          {!!message.evidence?.length && <Evidence evidence={message.evidence}/>}
          {!!message.downloads?.length && <div className="assistant-downloads">{message.downloads.map(file => <a key={file.url} className="button secondary" href={file.url} download={file.filename}><Download size={17} aria-hidden="true"/>{file.filename}</a>)}</div>}</div>)}
        {working && <p className="assistant-bubble" role="status">Reading your message and checking relevant records…</p>}
      </div>
      <div className="assistant-input-area">
        {!cloud && <p className="form-message">Sign in to a connected workspace to use AI. Demo records stay on this device.</p>}
        {!!files.length && <div className="assistant-files">{files.map((file, index) => <span key={index}><FileText size={14}/>{file.name}<button type="button" disabled={locked} onClick={() => setFiles(current => current.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><X size={14}/></button></span>)}</div>}
        <form className="assistant-composer" onSubmit={send}>
          <input ref={upload} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.csv,.txt" className="sr-only" disabled={locked || !cloud} onChange={e => void attach(e.target.files)}/>
          <textarea aria-label="Message to the finance assistant" aria-describedby="assistant-keyboard-hint" placeholder="Ask a question or describe what to record…" value={prompt} rows={3} maxLength={24000} disabled={locked || !cloud} onChange={e => setPrompt(e.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
          <div className="assistant-composer-toolbar"><div><button type="button" className="icon-button" title="Attach a statement (up to 3 MB per chat)" aria-label="Attach a statement" disabled={locked || !cloud} onClick={() => upload.current?.click()}><Paperclip size={19}/></button><span id="assistant-keyboard-hint">Ctrl / ⌘ + Enter to send</span></div>
          {working ? <button type="button" className="button secondary" aria-label="Stop response" onClick={() => controller.current?.abort()}><Square size={17}/></button>
            : <button type="submit" className="button primary" aria-label="Send message" disabled={!cloud || locked || (!prompt.trim() && !files.length)}><ArrowUp size={19}/></button>}
          </div>
        </form>
        <p className="assistant-privacy">{providerName} processes your messages, attachments and relevant records. Chat stays in this tab. <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></p>{reading && <p role="status">Attaching files…</p>}{problem && <p className="form-message error" role="alert">{problem}</p>}
      </div>
    </section>
    <section className="panel assistant-preview ai-preview" aria-label="Review proposed changes">
      <header><span className="glyph" data-tone="amber"><ClipboardCheck size={19}/></span><div><h2>Your review area</h2><p>Check each change before saving.</p></div><span className="pill amber">{previews.length + changes.length ? `${previews.length + changes.length} pending` : "No drafts"}</span></header>
      {!!changes.length && <div className="assistant-change-review">{changes.map(change => <div className="assistant-change" key={change.id}><strong>{change.title}</strong><p>{change.detail}</p><div className="button-line"><button type="button" className={"button " + (change.remove ? "danger" : "primary")} disabled={locked} onClick={() => void approveChange(change)}>{saving ? "Saving…" : change.remove ? "Confirm undo" : "Confirm change"}</button><button type="button" className="button quiet" disabled={locked} onClick={() => setChanges(current => current.filter(item => item.id !== change.id))}>Discard change</button></div></div>)}</div>}
    {previews.length ? <form ref={form} className="assistant-entry-review" onSubmit={submit} noValidate>
      <div className="assistant-review-intro"><h3>Review {previews.length} {previews.length === 1 ? "entry" : "entries"}</h3><p>Check dates, amounts, and accounts. Nothing is saved until you submit.</p></div>
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
      <div className="button-line"><button type="button" className="button quiet" disabled={locked} onClick={() => { setPreviews([]); setStatement(null); setSelected(new Set()); }}>Discard drafts</button><button type="submit" className="button primary" disabled={locked || !selected.size}><Check size={17}/>{saving ? "Saving…" : `Submit ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`}</button></div>
    </form> : !changes.length && <div className="assistant-review-empty"><span className="glyph" data-tone="amber"><ClipboardCheck size={25} aria-hidden="true"/></span><h3>A second look before you save</h3><p>Describe an entry or attach a statement. Your drafts and proposed changes will appear here for review.</p><span>Questions and summaries leave your records unchanged.</span></div>}
    </section>
    </div>
  </div>;
}
