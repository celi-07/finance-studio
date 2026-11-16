"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { aiProviders, personalAIConfigSchema, type AIProvider, type PersonalAIConfig } from "@/lib/ai-provider-config";
import { Field, Modal } from "./ledger-ui";
import { Picker } from "./ledger-picker";

export function AssistantAISettings({ config, onChange, onClose }: {
  config: PersonalAIConfig | null; onChange: (config: PersonalAIConfig | null) => void; onClose: () => void;
}) {
  const [source, setSource] = useState(config ? "personal" : "studio");
  const [provider, setProvider] = useState<AIProvider>(config?.provider ?? "gemini");
  const [model, setModel] = useState(config?.model ?? aiProviders.gemini.model);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  function save(event: FormEvent) {
    event.preventDefault();
    if (source === "studio") { onChange(null); onClose(); return; }
    const result = personalAIConfigSchema.safeParse({ provider, model, apiKey });
    if (!result.success) {
      const form = event.currentTarget as HTMLFormElement;
      setErrors(Object.fromEntries(result.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return;
    }
    onChange(result.data); onClose();
  }
  return <Modal title="AI settings" subtitle="Choose which AI handles your assistant requests." onClose={onClose} accentHeader>
    <form onSubmit={save} noValidate>
      <div className="form-grid assistant-settings-fields">
        <fieldset className="assistant-ai-source full"><legend>AI connection</legend>
          <label><input type="radio" name="ai-source" value="studio" checked={source === "studio"} onChange={() => setSource("studio")}/><span><strong>Finance Studio AI</strong><small>Use the included Gemini connection.</small></span></label>
          <label><input type="radio" name="ai-source" value="personal" checked={source === "personal"} onChange={() => setSource("personal")}/><span><strong>Use my own API key</strong><small>Choose Claude, GPT, or Gemini. Your provider bills your usage.</small></span><KeyRound size={17} aria-hidden="true"/></label>
        </fieldset>
        {source === "personal" && <>
          <Field label="Provider" full><Picker label="AI provider" value={provider} options={Object.entries(aiProviders).map(([value, details]) => ({ value, label: details.label }))} onValueChange={value => {
            const next = value as AIProvider; setProvider(next); setModel(aiProviders[next].model); setApiKey(""); setVisible(false); setErrors({});
          }}/></Field>
          <Field label="Model ID" full error={errors.model} hint="Use a model available to your API account that supports tools, images, and PDFs.">
            <input value={model} onChange={event => { setModel(event.target.value); setErrors({}); }} aria-invalid={!!errors.model} autoComplete="off" spellCheck={false} maxLength={100}/>
          </Field>
          <div className="full assistant-key-field">
            <Field label="API key" error={errors.apiKey}><input type={visible ? "text" : "password"} value={apiKey} onChange={event => { setApiKey(event.target.value); setErrors({}); }} aria-invalid={!!errors.apiKey}
              placeholder="Paste your personal API key" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={512}/></Field>
            <button className="icon-button" type="button" aria-label={visible ? "Hide API key" : "Show API key"} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
          </div>
          <p className="full assistant-settings-link"><a href={aiProviders[provider].keyUrl} target="_blank" rel="noreferrer">Get an API key from {aiProviders[provider].label} ↗</a></p>
          <div className="full assistant-key-note"><ShieldCheck size={18} aria-hidden="true"/><p>Your key is used only for your signed-in requests. It stays in this tab and clears when you refresh or sign out; Finance Studio does not save it. Requests go through our server to your selected provider. Your next message includes this chat and relevant financial records.</p></div>
        </>}
      </div>
      <div className="modal-footer">{config && <button type="button" className="button quiet push" onClick={() => { onChange(null); onClose(); }}>Remove my key</button>}
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Use {source === "studio" ? "Finance Studio AI" : aiProviders[provider].label}</button>
      </div>
    </form>
  </Modal>;
}
