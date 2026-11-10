"use client";

import { useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Layers3, LockKeyhole, Sheet } from "lucide-react";
import { getSupabase } from "@/lib/ledger-cloud";
import type { CloudConfig } from "@/lib/ledger-cloud-config";
import { Brand } from "./ledger-ui";

export function FinanceWelcome({ demo, onStart }: { demo: boolean; onStart: () => void }) {
  return <main className="welcome">
    <header className="welcome-header"><Brand/><button className="button secondary" onClick={onStart}>{demo ? "Try demo" : "Sign in"}</button></header>
    <section className="welcome-hero" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <p className="welcome-kicker">Free personal finance tracker</p>
        <h1 id="welcome-title">See where your<br className="welcome-break"/> money goes.</h1>
        <p>Track spending, income, reimbursements and investments in one simple place. Keep personal and business records separate, then see the whole picture at a glance.</p>
        <div className="button-line"><button className="button primary" onClick={onStart}>{demo ? "Try the demo" : "Get started"}<ArrowRight size={16}/></button><a className="button quiet" href="#features">Explore features</a></div>
        <div className="welcome-privacy"><LockKeyhole size={15} aria-hidden="true"/> {demo ? "The demo uses sample data and saves changes in this browser." : "Financial records are restricted to your signed-in account."}</div>
      </div>
      <div className="panel welcome-preview" aria-label="Example overview with fictional data">
        <div className="preview-heading"><div><span>Overview</span><strong>All sheets</strong></div><small>Sample data</small></div>
        <div className="preview-chart" aria-hidden="true">{[34, 51, 44, 72, 56, 86, 70, 100].map(height => <i key={height} style={{ height: height + "%" }}/>)}</div>
        <dl className="preview-amounts"><div><dt>Personal spending</dt><dd>Rp 6.000.000</dd></div><div><dt>Investments</dt><dd>USD 500.00</dd></div><div><dt>Business deposits</dt><dd>CNY 123,010.00</dd></div></dl>
      </div>
    </section>
    <section id="features" className="welcome-features" aria-label="Features">
      <article><span className="glyph" data-tone="orchid"><Layers3 size={20}/></span><h2>Separate finance sheets</h2><p>Give each business, project, or personal budget its own accounts and records.</p></article>
      <article><span className="glyph" data-tone="mint"><Sheet size={20}/></span><h2>Quick entry and spreadsheet paste</h2><p>Enter one transaction in the form or paste a batch from Excel or Google Sheets.</p></article>
      <article><span className="glyph" data-tone="amber"><ChartNoAxesCombined size={20}/></span><h2>Reports in your currencies</h2><p>Review each currency’s balance and download a monthly PDF statement.</p></article>
    </section>
    <footer className="welcome-footer"><span>Finance Studio @whiteeorangee</span><a href="mailto:whiteeorangee@gmail.com">Contact support</a></footer>
  </main>;
}

export function ProviderSignIn({ cloud, aboveEmailSubmit }: { cloud: CloudConfig; aboveEmailSubmit?: boolean }) {
  const [pending, setPending] = useState<"google" | "apple" | null>(null);
  const [problem, setProblem] = useState("");
  async function connect(provider: "google" | "apple") {
    if (pending) return;
    setPending(provider);
    setProblem("");
    try {
      const { error } = await getSupabase(cloud).auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + "/" } });
      if (error) throw error;
    } catch {
      setProblem("Couldn’t start sign-in. Try again in a moment.");
      setPending(null);
    }
  }
  const apple = cloud.authMode !== "google" && <button type="button" aria-label="Sign in with Apple" onClick={() => void connect("apple")} disabled={pending !== null}><img src="/apple-sign-in.png" alt=""/></button>;
  return <div className="provider-sign-in">
    {aboveEmailSubmit && apple}
    <button type="button" className="button google-provider" aria-label="Sign in with Google" onClick={() => void connect("google")} disabled={pending !== null}><img src="/google-sign-in.png" alt=""/></button>
    {!aboveEmailSubmit && apple}
    {pending && <p role="status">Opening {pending === "google" ? "Google" : "Apple"}…</p>}
    {problem && <p role="alert" className="form-message error">{problem}</p>}
  </div>;
}
