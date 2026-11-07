"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, HandCoins, LayoutDashboard, List, Menu, Plus, Settings2, ShieldCheck, Sheet, TrendingUp } from "lucide-react";
import { accountName, activeFields, dayLabel, emptyWorkspace, money, monthLabel, shiftMonth, today, type Activity, type Collection, type Entry, type Field as Definition, type Kind, type Workspace } from "@/lib/ledger";
import { createDemo, demoMonth, exportDemo, readDemo, writeDemo } from "@/lib/demo";
import { configured, deleteCloud, getSupabase, loadCloud, upsertCloud } from "@/lib/ledger-cloud";
import { downloadStatement } from "@/lib/statement";
import { EntryDialog } from "./ledger-entry";
import { ManagementDialog, ReceiptDialog, Settings, TaskForm, ValueDialog, type Management } from "./ledger-settings";
import { Brand, Empty, Field, Modal } from "./ledger-ui";
import { filterActivity, Investments, Overview, Reimbursements, Transactions, type Filters } from "./ledger-views";

const routes = {
  overview: { label: "Overview", caption: "A clear picture of your money this month.", icon: LayoutDashboard },
  transactions: { label: "Transactions", caption: "Search, review and record your financial activity.", icon: List },
  reimbursements: { label: "Reimbursements", caption: "Follow what’s owed, what’s paid and what’s still outstanding.", icon: HandCoins },
  investments: { label: "Investments", caption: "Track what you’ve contributed and how much it’s worth.", icon: TrendingUp },
  settings: { label: "Settings", caption: "Make Ledger work the way you track money.", icon: Settings2 },
} as const;
type Route = keyof typeof routes;
type Panel =
  | { type: "entry"; original?: Entry; kind?: Kind; preset?: string; bulk?: boolean }
  | { type: "receive"; id: string } | { type: "value"; id: string } | { type: "manage"; edit: Management }
  | { type: "delete"; entry: Entry } | { type: "receipt"; row: Activity } | { type: "reset" };
type Identity = { id: string; email?: string };
type AuthMode = "sign-in" | "sign-up" | "reset" | "recover";

function AuthScreen({ recovery, onRecovered }: { recovery: boolean; onRecovered: () => void }) {
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
      const auth = getSupabase().auth;
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
        if (!data.session) setMessage("Check your email for a confirmation link, then return to Ledger.");
      } else {
        const { error: issue } = await auth.signInWithPassword({ email, password });
        if (issue) throw issue;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in could not be completed."); }
    finally { setWorking(false); }
  }
  function switchTo(next: AuthMode) { setMode(next); setMessage(""); setError(""); }
  return <main className="auth-screen"><section className="panel auth-panel"><Brand/><h1>{title}</h1><p>Access your personal finance workspace.</p>
    <form onSubmit={submit}>
      {current !== "recover" && <Field label="Email"><input required name="email" type="email" autoComplete="email"/></Field>}
      {current !== "reset" && <Field label={current === "recover" ? "New password" : "Password"}><input required name="password" type="password" minLength={current === "sign-in" ? undefined : 8} autoComplete={current === "sign-in" ? "current-password" : "new-password"}/></Field>}
      {error && <p className="form-message error" role="alert">{error}</p>}{message && <p className="form-message success" role="status">{message}</p>}
      <button className="button primary" disabled={working}>{working ? "Working…" : label}</button>
    </form>
    {current !== "recover" && <div className="button-line">
      {current === "sign-in" ? <><button className="button quiet" onClick={() => switchTo("sign-up")}>Create account</button><button className="button quiet" onClick={() => switchTo("reset")}>Forgot password?</button></> : <button className="button quiet" onClick={() => switchTo("sign-in")}>Back to sign in</button>}
    </div>}
  </section></main>;
}

export default function LedgerApp() {
  const [route, setRoute] = useState<Route>("overview");
  const [month, setMonth] = useState(demoMonth);
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const dataRef = useRef(data);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const owner = useRef<string | null>(null);
  const initialized = useRef(false);
  const saving = useRef(false);
  const [recovery, setRecovery] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
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
    if (!configured) {
      try { update(readDemo()); }
      catch (error) { setProblem(errorText(error)); }
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabase();
      const resetRequested = new URLSearchParams(window.location.search).has("recover");
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted) return;
        const user = session?.user ?? null;
        const nextOwner = user?.id ?? null;
        if ((event === "PASSWORD_RECOVERY" || (event === "INITIAL_SESSION" && resetRequested)) && user) setRecovery(true);
        if (initialized.current && nextOwner === owner.current) return;
        initialized.current = true;
        owner.current = nextOwner;
        setIdentity(user ? { id: user.id, email: user.email } : null);
        update(emptyWorkspace);
        setPanel(null); setProblem(""); setNotice("");
        if (!nextOwner) { setRecovery(false); setLoading(false); return; }
        setLoading(true);
        setTimeout(() => {
          loadCloud(nextOwner).then(workspace => {
            if (mounted && owner.current === nextOwner) update(workspace);
          }).catch(error => { if (mounted && owner.current === nextOwner) setProblem(errorText(error)); })
            .finally(() => { if (mounted && owner.current === nextOwner) setLoading(false); });
        }, 0);
      });
      return () => { mounted = false; initialized.current = false; subscription.unsubscribe(); };
    } catch (error) { setProblem(errorText(error)); setLoading(false); }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4800);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Route) {
    setRoute(next); setMenu(false);
    if (window.location.hash !== "#" + next) window.history.pushState(null, "", "#" + next);
    window.scrollTo({ top: 0 });
  }
  function openEntry(kind?: Kind, investment?: string, bulk?: boolean) {
    if (!data.accounts.some(account => !account.archived && account.kind !== "investment")) {
      navigate("settings");
      setNotice("Add a bank, wallet or cash account before recording an entry.");
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
      if (currentOwner) await upsertCloud(currentOwner, collection, rows);
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
    if (currentOwner) await deleteCloud(currentOwner, "transactions", entry.id);
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
    try { const { error } = await getSupabase().auth.signOut(); if (error) throw error; }
    catch (error) { setProblem(errorText(error)); }
  }

  if (configured && (recovery || (!loading && !identity && !problem))) return <AuthScreen recovery={recovery} onRecovered={() => { setRecovery(false); window.history.replaceState(null, "", "/"); }}/>;
  if (configured && (loading || !identity || problem && data === emptyWorkspace)) return <main className="auth-screen"><section className="panel auth-panel"><Brand/>{problem ? <Empty title="Couldn’t open your workspace" description={problem} action={<div className="button-line"><button className="button secondary" onClick={() => window.location.reload()}>Try again</button>{identity && <button className="button quiet" onClick={signOut}>Sign out</button>}</div>}/> : <p role="status">Opening your workspace…</p>}</section></main>;

  const page = routes[route];
  const close = () => setPanel(null);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand/><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={22}/></button></div>
      <nav className={menu ? "nav open" : "nav"} aria-label="Workspace">
        <span className="nav-caption">WORKSPACE</span>
        {Object.entries(routes).map(([key, { label, icon: Icon }]) => <a key={key} href={"#" + key} aria-current={route === key ? "page" : undefined}
          onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(key as Route); } }}><Icon size={19}/>{label}</a>)}
      </nav>
      <div className="sidebar-bottom"><span className="glyph green"><ShieldCheck size={18}/></span><div><strong>{configured ? "Private workspace" : "Demo workspace"}</strong><small>{configured ? "Connected to Supabase" : "Saved in this browser"}</small></div></div>
    </aside>
    <main className="main-content" id="main-content">
      <div className="topbar"><span>Personal workspace <ChevronRight size={14}/> <strong>{page.label}</strong></span><span className="workspace-badge"><i/> {configured ? "Connected" : "Demo mode"}</span></div>
      <div className="page">
        <header className="page-heading"><div><div className="eyebrow">YOUR MONEY AT A GLANCE</div><h1>{page.label}</h1><p>{page.caption}</p></div>
          <div className="header-actions">
            {route !== "settings" && <div className="month-control" aria-label="Reporting month">
              <button className="icon-button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16}/></button>
              <label className="month-label"><CalendarDays size={16}/><span>{monthLabel(month)}</span><ChevronDown size={14}/><input type="month" aria-label="Select reporting month" value={month} min="1900-01" max="2199-12" onChange={event => { if (/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }}/></label>
              <button className="icon-button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16}/></button>
            </div>}
            {route !== "settings" && <button className="button secondary" onClick={makePdf} disabled={exporting || loading}><Download size={17}/>{exporting ? "Preparing…" : "Download PDF"}</button>}
            {route === "transactions" && <button className="button secondary" onClick={() => openEntry(undefined, undefined, true)}><Sheet size={17}/> Spreadsheet</button>}
            <button className="button primary" onClick={() => openEntry()}><Plus size={19}/> Add entry</button>
          </div>
        </header>
        {problem && <div className="form-message error" role="alert"><CircleAlert size={18}/>{problem}<button className="button quiet" onClick={() => setProblem("")}>Dismiss</button></div>}
        {loading && <div className="panel"><Empty title="Opening your workspace" description="Loading entries and accounts…"/></div>}
        {!loading && route === "overview" && <Overview workspace={data} month={month} onBrowse={() => navigate("transactions")} onOpen={openActivity} onAdd={() => openEntry()}/>}
        {!loading && route === "transactions" && <Transactions workspace={data} month={month} filters={filters} setFilters={setFilters} onOpen={openActivity} onAdd={() => openEntry()}/>}
        {!loading && route === "reimbursements" && <Reimbursements workspace={data} month={month} onReceive={id => setPanel({ type: "receive", id })}
          onOpen={id => { const entry = data.transactions.find(row => row.id === id); if (entry) setPanel({ type: "entry", original: entry }); }}/>}
        {!loading && route === "investments" && <Investments workspace={data} month={month} onEntry={openEntry} onValue={id => setPanel({ type: "value", id })} onSettings={() => navigate("settings")}/>}
        {!loading && route === "settings" && <Settings workspace={data} cloud={configured} email={identity?.email} onManage={edit => setPanel({ type: "manage", edit })}
          onMove={moveField} onReset={() => setPanel({ type: "reset" })} onExport={() => exportDemo(data)} onSignOut={signOut}/>}
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
