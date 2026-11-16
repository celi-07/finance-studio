"use client";
import { useState } from "react";
import { createAIDemo } from "@/lib/ai-demo";
import { accountCurrency, money } from "@/lib/ledger";
import { DemoEntryAssistant } from "./ledger-demo-assistant";

export function AIDemo() {
  const [data, setData] = useState(createAIDemo);
  const [generation, setGeneration] = useState(0);
  const originalCount = createAIDemo().transactions.length;
  const reviewed = data.transactions.slice(originalCount);
  return <div className="ai-demo">
    <div className="panel ai-demo-banner"><div><span className="pill amber">Fictional-data portfolio demo</span><h2>Try a financial AI workflow</h2><p>No sign-in or personal documents needed. AI answers use a fixed sample ledger. Review edits and submitted rows stay in this tab; they do not change the AI’s original sample history.</p></div><button type="button" className="button secondary" onClick={() => { setData(createAIDemo()); setGeneration(current => current + 1); }}>Reset demo</button></div>
    <DemoEntryAssistant key={generation} workspace={data} onSave={async entries => { setData(current => ({ ...current, transactions: [...current.transactions, ...entries] })); }}/>
    <section className="panel ai-demo-ledger"><h2>Fictional review ledger</h2><p>{reviewed.length} reviewed {reviewed.length === 1 ? "entry" : "entries"} added in this tab. Nothing is written to your Finance Studio account or sent back to Gemini.</p>
      {reviewed.length ? <div className="assistant-evidence-table"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>{reviewed.map(entry => <tr key={entry.id}><td>{entry.occurred_on}</td><td>{entry.description}</td><td>{money(entry.amount_minor, accountCurrency(data.accounts.find(a => a.id === entry.account_id)))}</td></tr>)}</tbody></table></div> : <p>Choose the sample PDF or dinner scenario, review the proposed entries, and submit them to see this step.</p>}
      <details><summary>Explore the original sample ledger</summary><div className="assistant-evidence-table"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>{createAIDemo().transactions.map(entry => <tr key={entry.id}><td>{entry.occurred_on}</td><td>{entry.description}</td><td>{money(entry.amount_minor, accountCurrency(data.accounts.find(a => a.id === entry.account_id)))}</td></tr>)}</tbody></table></div></details>
    </section>
  </div>;
}
