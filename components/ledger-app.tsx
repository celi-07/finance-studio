"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { isAuthError } from "@supabase/supabase-js";
import { ChartNoAxesCombined, CircleAlert, Download, HandCoins, PanelsTopLeft, Plus, ReceiptText, ShieldCheck, Sheet, SlidersHorizontal } from "lucide-react";
import { accountName, activeFields, dayLabel, emptyWorkspace, money, today, type Activity, type Collection, type Entry, type Field as Definition, type Kind, type Workspace } from "@/lib/ledger";
import { createDemo, demoMonth, exportDemo, readDemo, writeDemo } from "@/lib/demo";
import { deleteCloud, getSupabase, loadCloud, upsertCloud } from "@/lib/ledger-cloud";
import type { CloudConfig } from "@/lib/ledger-cloud-config";
import { downloadStatement } from "@/lib/statement";
import { EntryDialog } from "./ledger-entry";
import { ManagementDialog, ReceiptDialog, Settings, TaskForm, ValueDialog, type Management } from "./ledger-settings";
import { Brand, Empty, Field, Modal } from "./ledger-ui";
import { ReportingMonth } from "./ledger-picker";
import { filterActivity, Investments, Overview, Reimbursements, Transactions, type Filters } from "./ledger-views";

const routes = {
  overview: { label: "Overview", caption: "", icon: PanelsTopLeft },
  transactions: { label: "Transactions", caption: "Income, expenses and transfers", icon: ReceiptText },
  reimbursements: { label: "Reimbursements", caption: "Claims and payments", icon: HandCoins },
  investments: { label: "Investments", caption: "Holdings and cash movements", icon: ChartNoAxesCombined },
  settings: { label: "Settings", caption: "Accounts, categories and entry fields", icon: SlidersHorizontal },
} as const;
type Route = keyof typeof routes;
type Panel =
  | { type: "entry"; original?: Entry; kind?: Kind; preset?: string; bulk?: boolean }
  | { type: "receive"; id: string } | { type: "value"; id: string } | { type: "manage"; edit: Management }
  | { type: "delete"; entry: Entry } | { type: "receipt"; row: Activity } | { type: "reset" };
type AuthMode = "sign-in" | "sign-up" | "reset" | "recover";

function authMessage(error: unknown, mode: AuthMode) {
  const code = isAuthError(error) ? error.code : undefined;
  if (code === "invalid_credentials") return "Check your email and password and try again.";
  if (code === "email_not_confirmed") return "Open the confirmation link in your email before signing in.";
  if (code === "weak_password") return "Choose a stronger password and try again.";
  if (code === "same_password") return "Choose a password you haven’t used for this account.";
  if (code?.endsWith("rate_limit")) return "Too many attempts. Wait a moment and try again.";
  return {
    "sign-in": "Couldn’t sign in. Try again in a moment.",
    "sign-up": "Couldn’t create your account. Try again in a moment.",
    reset: "Couldn’t send the reset link. Try again in a moment.",
    recover: "Couldn’t update your password. Try requesting a new reset link.",
  }[mode];
}

function AuthScreen({ cloud, recovery, onRecovered }: { cloud: CloudConfig; recovery: boolean; onRecovered: () => void }) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const current = recovery ? "recover" : mode;
  const title = { "sign-in": "Sign in to Ledger", "sign-up": "Create your workspace", reset: "Reset your password", recover: "Set a new password" }[current];
  const label = { "sign-in": "Sign in", "sign-up": "Create account", reset: "Send reset link", recover: "Update password" }[current];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const origin = window.location.origin + "/";
    setError(""); setMessage(""); setWorking(true);
    try {
      const auth = getSupabase(cloud).auth;
      if (current === "recover") {
        const { error: issue } = await auth.updateUser({ password });
        if (issue) throw issue;
        onRecovered();
      } else if (current === "reset") {
        const { error: issue } = await auth.resetPasswordForEmail(email, { redirectTo: origin + "?recover=1" });
        if (issue) throw issue;
        setMessage("If this email has an account, a reset link will arrive shortly. Open it in this browser.");
      } else if (current === "sign-up") {
        const { data, error: issue } = await auth.signUp({ email, password, options: { emailRedirectTo: origin } });
        if (issue) throw issue;
        if (!data.session) setMessage("Check your email and open the confirmation link in this browser.");
      } else {
        const { error: issue } = await auth.signInWithPassword({ email, password });
        if (issue) throw issue;
      }
    } catch (reason) { setError(authMessage(reason, current)); }
    finally { setWorking(false); }
  }
  function switchTo(next: AuthMode) { setMode(next); setMessage(""); setError(""); }
  return <main className="auth-screen"><section className="panel auth-panel"><Brand/><h1>{title}</h1><p>{current === "sign-up" ? "Create an account to keep your finances in a private workspace." : "Access your personal finance workspace."}</p>
    <form onSubmit={submit}>
      {current !== "recover" && <Field label="Email"><input required name="email" type="email" autoComplete={current === "reset" ? "email" : "username"}/></Field>}
      {current !== "reset" && <Field label={current === "recover" ? "New password" : "Password"}><input required name="password" type="password" minLength={current === "sign-in" ? undefined : 8} autoComplete={current === "sign-in" ? "current-password" : "new-password"}/></Field>}
      {error && <p className="form-message error" role="alert">{error}</p>}{message && <p className="form-message success" role="status">{message}</p>}
      <button className="button primary" disabled={working}>{working ? "Working…" : label}</button>
    </form>
    {current !== "recover" && <div className="button-line">
      {current === "sign-in" ? <><button className="button quiet" disabled={working} onClick={() => switchTo("sign-up")}>Create account</button><button className="button quiet" disabled={working} onClick={() => switchTo("reset")}>Forgot password?</button></> : <button className="button quiet" disabled={working} onClick={() => switchTo("sign-in")}>Back to sign in</button>}
    </div>}
  </section></main>;
}

export default function LedgerApp({ cloud }: { cloud: CloudConfig | null }) {
  const configured = cloud !== null;
  const [route, setRoute] = useState<Route>("overview");
  const [month, setMonth] = useState(() => configured ? today().slice(0, 7) : demoMonth());
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const dataRef = useRef(data);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const owner = useRef<string | null>(null);
  const initialized = useRef(false);
  const saving = useRef(false);
  const [recovery, setRecovery] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<Filters>({ search: "", kind: "", account: "" });
  function update(next: Workspace) { dataRef.current = next; setData(next); }
  function errorText(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Try again."; }
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      if (!hash || Object.hasOwn(routes, hash)) setRoute((hash || "overview") as Route);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    let mounted = true;
    if (!cloud) {
      try { update(readDemo()); }
      catch (error) { setProblem(errorText(error)); }
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabase(cloud);
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted) return;
        const user = session?.user ?? null;
        const nextOwner = user?.id ?? null;
        if (event === "PASSWORD_RECOVERY" && user) setRecovery(true);
        if (initialized.current && nextOwner === owner.current) return;
        initialized.current = true;
        owner.current = nextOwner;
        setSignedIn(Boolean(nextOwner));
        update(emptyWorkspace);
        setPanel(null); setProblem(""); setNotice("");
        if (!nextOwner) { setRecovery(false); setLoading(false); return; }
        setLoading(true);
        setTimeout(() => {
          loadCloud(supabase, nextOwner).then(workspace => {
            if (mounted && owner.current === nextOwner) update(workspace);
          }).catch(() => { if (mounted && owner.current === nextOwner) setProblem("Couldn’t load your records. Try again in a moment."); })
            .finally(() => { if (mounted && owner.current === nextOwner) setLoading(false); });
        }, 0);
      });
      return () => { mounted = false; initialized.current = false; subscription.unsubscribe(); };
    } catch { setProblem("Couldn’t connect to your workspace. Try again in a moment."); setLoading(false); }
  }, [cloud]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4800);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Route) {
    setRoute(next);
    if (window.location.hash !== "#" + next) window.history.pushState(null, "", "#" + next);
    window.scrollTo({ top: 0 });
  }
  function openEntry(kind?: Kind, investment?: string, bulk?: boolean) {
    if (!data.accounts.some(account => !account.archived && account.kind !== "investment")) {
      navigate("settings");
      setNotice("Add a bank account, wallet or cash balance to record your first entry.");
      setPanel({ type: "manage", edit: { collection: "accounts" } });
      return;
    }
    setPanel({ type: "entry", kind, preset: investment, bulk });
  }
  function openActivity(row: Activity) {
    setPanel(row.entry ? { type: "entry", original: row.entry } : { type: "receipt", row });
  }
  async function save<K extends Collection>(collection: K, rows: Workspace[K]) {
    if (saving.current) throw Error("Another change is being saved. Try again in a moment.");
    const currentOwner = owner.current;
    if (configured && !currentOwner) throw Error("Sign in before saving changes.");
    saving.current = true;
    try {
      if (cloud && currentOwner) await upsertCloud(getSupabase(cloud), currentOwner, collection, rows);
      if (currentOwner !== owner.current) throw Error("Your account changed while saving. Reopen the entry.");
      const ids = new Set(rows.map(row => row.id));
      const next = { ...dataRef.current, [collection]: [...dataRef.current[collection].filter(row => !ids.has(row.id)), ...rows] };
      if (!configured) writeDemo(next);
      update(next);
      setNotice(rows.length === 1 ? "Changes saved" : rows.length + " changes saved");
    } finally { saving.current = false; }
  }
  async function removeEntry(entry: Entry) {
    if (dataRef.current.reimbursement_receipts.some(row => row.expense_id === entry.id)) throw Error("This entry has linked payments. The claim and its payments need to stay together.");
    const currentOwner = owner.current;
    if (configured && !currentOwner) throw Error("Sign in before deleting.");
    if (cloud && currentOwner) await deleteCloud(getSupabase(cloud), currentOwner, "transactions", entry.id);
    if (currentOwner !== owner.current) throw Error("Your account changed while deleting.");
    const next = { ...dataRef.current, transactions: dataRef.current.transactions.filter(row => row.id !== entry.id) };
    if (!configured) writeDemo(next);
    update(next);
    setNotice("Entry deleted");
  }
  async function moveField(field: Definition, direction: number) {
    const ordered = activeFields(data);
    const index = ordered.findIndex(row => row.id === field.id);
    const other = ordered[index + direction];
    if (!other) return;
    try { await save("field_definitions", [{ ...field, position: other.position }, { ...other, position: field.position }]); }
    catch (error) { setProblem(errorText(error)); }
  }
  async function makePdf() {
    if (exporting) return;
    setExporting(true); setProblem("");
    try {
      const filtered = route === "transactions" && (filters.search || filters.kind || filters.account) ? filterActivity(data, month, filters) : undefined;
      await downloadStatement(data, month, !configured, filtered);
      setNotice("Statement downloaded");
    } catch (error) { setProblem(errorText(error)); }
    finally { setExporting(false); }
  }
  async function signOut() {
    if (!cloud) return;
    try { const { error } = await getSupabase(cloud).auth.signOut(); if (error) throw error; }
    catch { setProblem("Couldn’t sign out. Try again in a moment."); }
  }

  if (cloud && (recovery || (!loading && !signedIn && !problem))) return <AuthScreen cloud={cloud} recovery={recovery} onRecovered={() => { setRecovery(false); window.history.replaceState(null, "", "/"); }}/>;
  if (configured && (loading || !signedIn || problem && data === emptyWorkspace)) return <main className="auth-screen"><section className="panel auth-panel"><Brand/>{problem ? <Empty title="Couldn’t open your workspace" description={problem} action={<div className="button-line"><button className="button secondary" onClick={() => window.location.reload()}>Try again</button>{signedIn && <button className="button quiet" onClick={signOut}>Sign out</button>}</div>}/> : <p role="status">Opening your workspace…</p>}</section></main>;

  const page = routes[route];
  const close = () => setPanel(null);
  return <div className="app-shell" data-route={route}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand/></div>
      <nav className="nav" aria-label="Workspace" style={{ "--selection": Object.keys(routes).indexOf(route) } as CSSProperties}>
        <span className="nav-lens" aria-hidden="true"/>
        {Object.entries(routes).map(([key, { label, icon: Icon }]) => <a key={key} href={"#" + key} aria-current={route === key ? "page" : undefined}
          onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(key as Route); } }}>
          <Icon size={19} aria-hidden="true"/><span className="nav-label">{label}</span>
          <span className="nav-short">{key === "transactions" ? "Activity" : key === "reimbursements" ? "Claims" : key === "investments" ? "Invest" : label}</span>
        </a>)}
      </nav>
      <div className="sidebar-bottom"><span className="glyph" data-tone={configured ? "mint" : "blue"} aria-hidden="true"><ShieldCheck size={18}/></span><div><strong>{configured ? "Private workspace" : "Demo workspace"}</strong><small>{configured ? "Signed in" : "Saved in this browser"}</small></div></div>
    </aside>
    <main className="main-content" id="main-content">
      <div className="page">
        <header className="page-heading" key={"heading-" + route}><div className="page-title"><h1>{page.label}</h1>{page.caption && <p>{page.caption}</p>}<span className="mobile-workspace">{configured ? "Private workspace" : "Demo workspace"}</span></div>
          <div className={"header-actions" + (route === "settings" ? "" : " reporting-actions")}>
            {route !== "settings" && <ReportingMonth value={month} onChange={setMonth}/>}
            {route !== "settings" && <button className="button secondary report-export" aria-label={exporting ? "Preparing PDF" : "Download PDF"} onClick={makePdf} disabled={exporting || loading}>
              <Download size={17}/><span className="desktop-export">{exporting ? "Preparing…" : "Download PDF"}</span><span className="compact-export" aria-hidden="true">{exporting ? "Saving…" : "PDF"}</span>
            </button>}
            {route === "transactions" && <button className="button secondary sheet-action" onClick={() => openEntry(undefined, undefined, true)}><Sheet size={17}/> Spreadsheet</button>}
            <button className="button primary" onClick={() => openEntry()}><Plus size={19}/> Add entry</button>
          </div>
        </header>
        {problem && <div className="form-message error" role="alert"><CircleAlert size={18}/>{problem}<button className="button quiet" onClick={() => setProblem("")}>Dismiss</button></div>}
        {loading && <div className="panel"><Empty title="Opening your workspace" description="Loading entries and accounts…"/></div>}
        <div className="page-content" key={"content-" + route}>
          {!loading && route === "overview" && <Overview workspace={data} month={month} onBrowse={() => navigate("transactions")} onOpen={openActivity} onAdd={() => openEntry()}/>}
          {!loading && route === "transactions" && <Transactions workspace={data} month={month} filters={filters} setFilters={setFilters} onOpen={openActivity} onAdd={() => openEntry()}/>}
          {!loading && route === "reimbursements" && <Reimbursements workspace={data} month={month} onReceive={id => setPanel({ type: "receive", id })}
            onOpen={id => { const entry = data.transactions.find(row => row.id === id); if (entry) setPanel({ type: "entry", original: entry }); }}/>}
          {!loading && route === "investments" && <Investments workspace={data} month={month} onEntry={openEntry} onValue={id => setPanel({ type: "value", id })} onSettings={() => navigate("settings")}/>}
          {!loading && route === "settings" && <Settings workspace={data} cloud={configured} onManage={edit => setPanel({ type: "manage", edit })}
            onMove={moveField} onReset={() => setPanel({ type: "reset" })} onExport={() => exportDemo(data)} onSignOut={signOut}/>}
        </div>
        <footer className="footer"><span>Ledger · Personal finance</span><span>IDR · Asia/Jakarta</span></footer>
      </div>
    </main>
    {panel?.type === "entry" && <EntryDialog workspace={data} month={month} original={panel.original} kind={panel.kind} preset={panel.preset} initialBulk={panel.bulk} onClose={close}
      onDelete={entry => setPanel({ type: "delete", entry })} onSave={async entries => {
        await save("transactions", entries);
        if (!panel.original && entries.length === 1) setMonth(entries[0].occurred_on.slice(0, 7));
      }}/>}
    {panel?.type === "manage" && <ManagementDialog workspace={data} edit={panel.edit} close={close} save={save}/>}
    {panel?.type === "receive" && <ReceiptDialog workspace={data} expenseId={panel.id} close={close} save={save}/>}
    {panel?.type === "value" && <ValueDialog workspace={data} accountId={panel.id} close={close} save={save}/>}
    {panel?.type === "delete" && <TaskForm title="Delete this entry?" subtitle={panel.entry.description + " · " + money(panel.entry.amount_minor)} close={close} submit={() => removeEntry(panel.entry)} label="Delete entry">
      <p className="full muted">This permanently removes the entry and updates the related balances.</p>
    </TaskForm>}
    {panel?.type === "receipt" && panel.row.receipt && <Modal title="Reimbursement payment" subtitle={panel.row.title} onClose={close}>
      <dl className="compact-details receipt-detail"><div><dt>Received</dt><dd>{dayLabel(panel.row.date)}</dd></div><div><dt>Account</dt><dd>{accountName(data, panel.row.accountId)}</dd></div><div><dt>Amount</dt><dd>{money(panel.row.amount)}</dd></div>{panel.row.receipt.notes && <div><dt>Notes</dt><dd>{panel.row.receipt.notes}</dd></div>}</dl>
      <div className="modal-footer"><button className="button secondary" onClick={close}>Done</button></div>
    </Modal>}
    {panel?.type === "reset" && <TaskForm title="Reset demo workspace?" subtitle="This replaces the entries and settings saved in this browser with the original fictional data." close={close} label="Reset demo"
      submit={async () => { const fresh = createDemo(); writeDemo(fresh); update(fresh); setMonth(today().slice(0, 7)); setProblem(""); setNotice("Demo reset"); }}/>}
    {notice && <div className="toast" role="status"><ShieldCheck size={18}/>{notice}</div>}
  </div>;
}
