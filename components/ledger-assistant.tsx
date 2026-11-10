"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Check, Sparkles } from "lucide-react";
import { money, parseMoney, validateEntry, type Currency, type Entry, type EntryDraft, type Workspace } from "@/lib/ledger";
import { quickEntry, reviseQuickEntry, type QuickDraft } from "@/lib/quick-entry";
import { EntryFields } from "./ledger-entry";

export function EntryAssistant({ workspace, currency, onSave }: {
  workspace: Workspace; currency: Currency; onSave: (entry: Entry) => Promise<void>;
}) {
  const [messages, setMessages] = useState<{ role: "you" | "assistant"; text: string }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<QuickDraft | null>(null);
  const [claim, setClaim] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages]);

  function send(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || working) return;
    let reply: string;
    try {
      const next = preview ? reviseQuickEntry(workspace, preview, text) : quickEntry(workspace, text, currency);
      setPreview(next);
      if (next.draft.id !== preview?.draft.id || next.draft.kind !== "expense") setClaim(false);
      setErrors({}); setProblem("");
      reply = next.draft.account_id
        ? preview ? "I updated the draft. Check the preview before submitting." : "I prepared a draft. You can edit it or tell me what to change."
        : "I prepared the details. Pick an account in the preview or tell me which one to use.";
    } catch (error) {
      reply = error instanceof Error ? error.message : "I couldn’t read that message. Try one transaction at a time.";
    }
    setMessages(current => [...current, { role: "you" as const, text }, { role: "assistant" as const, text: reply }].slice(-40));
    setPrompt("");
  }
  function edit(update: (draft: EntryDraft) => EntryDraft) {
    setPreview(current => current ? { ...current, draft: update(current.draft) } : null);
    setErrors({}); setProblem("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview || working) return;
    setProblem("");
    const { draft } = preview;
    const result = validateEntry(workspace, claim ? draft : { ...draft, reimbursable: "", counterparty: "", due_on: null });
    setErrors(result.errors ?? {});
    if (!result.entry) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const entry = result.entry;
    setWorking(true);
    try {
      await onSave(entry);
      setMessages(current => [...current, { role: "assistant" as const, text: `Saved “${entry.description}” to this sheet.` }].slice(-40));
      setPreview(null); setClaim(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn’t save this transaction. Try again.");
    } finally { setWorking(false); }
  }
  const amount = preview ? parseMoney(preview.draft.amount, preview.currency) : null;

  return <div className="assistant-layout">
    <section className="panel assistant-chat" aria-label="Transaction chat">
      <header><span className="glyph" data-tone="orchid"><Sparkles size={19} aria-hidden="true"/></span><div><h2>Transaction assistant</h2><p>English and Indonesian · Processed on this device</p></div></header>
      <div className="assistant-thread" role="log" aria-label="Conversation" ref={thread}>
        <p className="assistant-bubble">Describe one income or expense. Try “Beli nasi goreng Rp47.900 tanggal 3 Okt 2026”. Then ask for a change like “ganti jumlah ke 50rb”.</p>
        {messages.map(({ role, text }, index) => <p key={index} className={"assistant-bubble " + role}><span className="sr-only">{role === "you" ? "You" : "Assistant"} </span>{text}</p>)}
      </div>
      <form className="assistant-composer" onSubmit={send}>
        <input aria-label="Message to the transaction assistant" placeholder={preview ? "Tell me what to change…" : "Describe a transaction…"}
          value={prompt} maxLength={280} onChange={event => setPrompt(event.target.value)}/>
        <button type="submit" className="button primary" aria-label="Send message" disabled={!prompt.trim() || working}><ArrowUp size={19} aria-hidden="true"/></button>
      </form>
    </section>
    {preview ? <form ref={form} className="panel assistant-preview" onSubmit={submit} noValidate>
      <header><div><h2>Transaction preview</h2><p>Check the draft and edit any field.</p></div><span className="pill amber">Draft</span></header>
      {amount !== null && <strong className="preview-total">{money(amount, preview.currency)}</strong>}
      <fieldset disabled={working}><legend className="sr-only">Transaction details</legend>
        <EntryFields workspace={workspace} draft={preview.draft} setDraft={edit} currency={preview.currency} errors={errors} claim={claim} setClaim={setClaim} lockCurrency/>
      </fieldset>
      {problem && <p className="form-message error" role="alert">{problem}</p>}
      <div className="button-line">
        <button type="button" className="button quiet" disabled={working} onClick={() => { setPreview(null); setErrors({}); setClaim(false); setProblem(""); }}>Discard draft</button>
        <button className="button primary" disabled={working}><Check size={17} aria-hidden="true"/> {working ? "Saving…" : "Submit transaction"}</button>
      </div>
    </form> : <section className="panel assistant-preview assistant-empty"><h2>Transaction preview</h2><p>Send a message to start an editable draft.</p></section>}
  </div>;
}
