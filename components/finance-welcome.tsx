"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChartNoAxesCombined, Layers3, LockKeyhole, Sheet } from "lucide-react";
import { getSupabase } from "@/lib/ledger-cloud";
import type { CloudConfig } from "@/lib/ledger-cloud-config";
import { Brand, Field } from "./ledger-ui";

export function FinanceWelcome({ demo, onStart }: { demo: boolean; onStart: () => void }) {
  return <main className="welcome">
    <header className="welcome-header"><Brand/><button className="button secondary" onClick={onStart}>{demo ? "Try demo" : "Sign in"}</button></header>
    <section className="welcome-hero" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <p className="welcome-kicker">Free personal finance tracker</p>
        <h1 id="welcome-title">See where your<br className="welcome-break"/> money goes.</h1>
        <p>Track spending, income, reimbursements and investments in one simple place. Keep personal and business records separate, then see the whole picture at a glance.</p>
        <div className="button-line"><button className="button primary" onClick={onStart}>{demo ? "Try the demo" : "Get started"}<ArrowRight size={16}/></button><a className="button quiet" href="#features">Explore features</a></div>
        <div className="welcome-privacy"><LockKeyhole size={15} aria-hidden="true"/> {demo ? "The demo uses sample data and saves changes in this browser." : "Your records are private to your verified account."}</div>
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
      <article><span className="glyph" data-tone="amber"><ChartNoAxesCombined size={20}/></span><h2>Charts and reports</h2><p>See monthly income, expenses and net wealth in charts. Review balances by currency and download PDF statements.</p></article>
      <article><span className="glyph" data-tone="blue"><LockKeyhole size={20}/></span><h2>Track without linking a bank</h2><p>Enter balances and transactions manually. Finance Studio keeps your ledger private to your account and never asks for bank credentials.</p></article>
    </section>
    <footer className="welcome-footer"><span>Finance Studio @whiteeorangee</span><a href="mailto:whiteeorangee@gmail.com">Contact support</a></footer>
  </main>;
}

export function VerifyEmail({ cloud, email, onSignOut, signOutProblem }: {
  cloud: CloudConfig; email: string; onSignOut: () => Promise<void>; signOutProblem: string;
}) {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const requested = useRef(false);
  const sendCode = useCallback(async () => {
    setSending(true); setProblem("");
    try {
      const { error } = await getSupabase(cloud).auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw error;
      setSent(true);
      setCooldown(true);
    } catch {
      setProblem("Couldn’t send a code. Wait a minute, then try again.");
    } finally { setSending(false); }
  }, [cloud, email]);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void sendCode();
  }, [sendCode]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 60_000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking || sending) return;
    const token = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setChecking(true); setProblem("");
    try {
      const { error } = await getSupabase(cloud).auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
    } catch {
      setProblem("This code is incorrect or expired. Check the code or request another.");
    } finally { setChecking(false); }
  }
  return <main className="auth-screen"><section className="panel auth-panel">
    <Brand/><h1>Verify your email</h1>
    <p>Enter the sign-in code for <strong>{email}</strong> to open your records.</p>
    <form onSubmit={verify}>
      <Field label="Verification code"><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required/></Field>
      {(problem || signOutProblem) && <p className="form-message error" role="alert">{problem || signOutProblem}</p>}
      {sending && <p className="muted" role="status">Sending your code…</p>}
      <button className="button primary" disabled={sending || checking}>{checking ? "Verifying…" : "Verify and sign in"}</button>
    </form>
    <div className="button-line">
      <button type="button" className="button quiet" disabled={sending || checking || cooldown} onClick={() => void sendCode()}>{sent ? "Resend code" : "Send code"}</button>
      <button type="button" className="button quiet" disabled={checking} onClick={() => void onSignOut()}>Sign out</button>
    </div>
  </section></main>;
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
