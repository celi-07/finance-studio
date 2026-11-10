"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { isAuthError } from "@supabase/supabase-js";
import { ArrowLeft, ChartNoAxesCombined, CircleAlert, Download, HandCoins, Layers3, LogOut, PanelsTopLeft, Pencil, Plus, ReceiptText, ShieldCheck, Sheet, SlidersHorizontal, Sparkles } from "lucide-react";
import { accountCurrency, accountName, activeFields, currencyForAccount, dayLabel, defaultCurrency, emptyWorkspace, entryClaims, inPeriod, isCurrency, money, paymentKey, today, workspaceForBook, workspaceForCurrency, type Activity, type Collection, type Currency, type Entry, type Field as Definition, type FinanceBook, type Kind, type Receipt, type SavingsGoal, type Workspace } from "@/lib/ledger";
import { createDemo, demoMonth, exportDemo, readDemo, writeDemo } from "@/lib/demo";
import { deleteCloud, getSupabase, loadCloud, upsertCloud } from "@/lib/ledger-cloud";
import type { CloudConfig } from "@/lib/ledger-cloud-config";
import { downloadStatement } from "@/lib/statement";
import { EntryDialog } from "./ledger-entry";
import { BookDialog, FinanceGuide, ManagementDialog, ReceiptDialog, Settings, TaskForm, ValueDialog, type Management } from "./ledger-settings";
import { Brand, Empty, Field, Modal } from "./ledger-ui";
import { Picker, ReportingPeriod, type PeriodMode } from "./ledger-picker";
import { CombinedOverview, filterActivity, Investments, Overview, Reimbursements, Transactions, type Filters } from "./ledger-views";
import { FinanceWelcome, ProviderSignIn } from "./finance-welcome";
import { ActivityCalendar, GoalDialog, SavingsGoals } from "./ledger-planning";
import { EntryAssistant } from "./ledger-assistant";

const routes = {
  overview: { label: "Overview", caption: "", icon: PanelsTopLeft },
  transactions: { label: "Transactions", caption: "Income, expenses and transfers", icon: ReceiptText },
  reimbursements: { label: "Reimbursements", caption: "Claims and payments", icon: HandCoins },
  investments: { label: "Investments", caption: "Holdings and cash movements", icon: ChartNoAxesCombined },
  assistant: { label: "Assistant", caption: "Draft a transaction in your own words", icon: Sparkles },
  settings: { label: "Settings", caption: "Accounts, categories and entry fields", icon: SlidersHorizontal },
} as const;
type Route = keyof typeof routes;
const personalSheet = "personal";
type Panel =
  | { type: "entry"; original?: Entry; kind?: Kind; preset?: string; bulk?: boolean }
  | { type: "receive"; id?: string; incomeId?: string } | { type: "value"; id: string } | { type: "manage"; edit: Management }
  | { type: "delete"; entry: Entry } | { type: "receipt"; receipt: Receipt } | { type: "delete-receipt"; receipt: Receipt } | { type: "reset" } | { type: "guide" } | { type: "book"; book?: FinanceBook }
  | { type: "goal"; goal?: SavingsGoal } | { type: "delete-goal"; goal: SavingsGoal };
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

function AuthScreen({ cloud, recovery, onRecovered, onBack, returnError }: { cloud: CloudConfig; recovery: boolean; onRecovered: () => void; onBack: () => void; returnError: boolean }) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const current = recovery ? "recover" : mode;
  const title = { "sign-in": "Sign in to Finance Studio", "sign-up": "Create an account", reset: "Reset your password", recover: "Set a new password" }[current];
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
  return <main className="auth-screen"><section className="panel auth-panel"><div className="auth-top">
    {current !== "recover" && <button type="button" className="icon-button" aria-label={current === "sign-in" ? "Back to home" : "Back to sign in"}
      onClick={current === "sign-in" ? onBack : () => switchTo("sign-in")}><ArrowLeft size={20} aria-hidden="true"/></button>}<Brand/></div>
    <h1>{title}</h1><p>{cloud.authMode === "oauth" ? "Use your Google or Apple account to get started." : current === "sign-up" ? "Use your email to create an account." : "Manage your finances in one place."}</p>
    {returnError && <p className="form-message error" role="alert">Sign-in was interrupted. Choose a sign-in method to try again.</p>}
    {cloud.authMode && current === "sign-in" && <ProviderSignIn cloud={cloud}/>}
    {cloud.authMode !== "oauth" && <form onSubmit={submit}>
      {current !== "recover" && <Field label="Email"><input required name="email" type="email" autoComplete={current === "reset" ? "email" : "username"}/></Field>}
      {current !== "reset" && <Field label={current === "recover" ? "New password" : "Password"}><input required name="password" type="password" minLength={current === "sign-in" ? undefined : 8} autoComplete={current === "sign-in" ? "current-password" : "new-password"}/></Field>}
      {error && <p className="form-message error" role="alert">{error}</p>}{message && <p className="form-message success" role="status">{message}</p>}
      <button className="button primary" disabled={working}>{working ? "Working…" : label}</button>
    </form>}
    {cloud.authMode !== "oauth" && current === "sign-in" && <div className="auth-links">
      <button className="button quiet" disabled={working} onClick={() => switchTo("reset")}>Forgot password?</button>
      <button className="button quiet" disabled={working} onClick={() => switchTo("sign-up")}>Create account</button>
    </div>}
  </section></main>;
}

export default function LedgerApp({ cloud }: { cloud: CloudConfig | null }) {
  const configured = cloud !== null;
  const [route, setRoute] = useState<Route>("overview");
  const [month, setMonth] = useState(() => configured ? today().slice(0, 7) : demoMonth());
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const period = periodMode === "month" ? month : periodMode === "year" ? month.slice(0, 4) : "all";
  const reportingPage = route !== "settings" && route !== "assistant";
  const [preferredCurrency, setPreferredCurrency] = useState<Currency>(defaultCurrency);
  const [bookId, setBookId] = useState("");
  const [allSheets, setAllSheets] = useState(true);
  const [allCurrencies, setAllCurrencies] = useState(true);
  const [showAccess, setShowAccess] = useState(false);
  const [returnError, setReturnError] = useState(false);
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const sheets = [{ id: "", name: "Personal" }, ...data.finance_books];
  const currentSheet = sheets.find(sheet => sheet.id === bookId) ?? sheets[0];
  const bookData = workspaceForBook(data, currentSheet.id);
  const showingAllSheets = route === "overview" && allSheets;
  const reportBase = showingAllSheets ? data : bookData;
  const availableCurrencies = Array.from(new Set(reportBase.accounts.map(accountCurrency))).sort();
  const currency = availableCurrencies.includes(preferredCurrency) ? preferredCurrency : availableCurrencies[0] ?? defaultCurrency;
  const showingAllCurrencies = route === "overview" && allCurrencies && availableCurrencies.length > 1;
  const combinedSheets = showingAllSheets && sheets.length > 1;
  const reportData = workspaceForCurrency(reportBase, currency);
  const cashCurrencies = Array.from(new Set(bookData.accounts.filter(account => account.kind !== "investment").map(accountCurrency)));
  const goalCurrencies = Array.from(new Set([...availableCurrencies, ...reportBase.savings_goals.map(goal => goal.currency)])).sort();
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
  const [personFilter, setPersonFilter] = useState<{ sheet: string; currency: Currency; people: string[] }>();
  const selectedPeople = personFilter?.sheet === currentSheet.id && personFilter.currency === currency ? personFilter.people : [];
  function update(next: Workspace) { dataRef.current = next; setData(next); }
  function errorText(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Try again."; }
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      if (!hash || Object.hasOwn(routes, hash)) setRoute((hash || "overview") as Route);
    };
    read();
    const url = new URL(window.location.href);
    if (url.searchParams.has("error") || url.hash.startsWith("#error=")) {
      setShowAccess(true);
      setReturnError(true);
      window.history.replaceState(null, "", "/");
    }
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
        if (cloud.authMode !== "oauth" && event === "PASSWORD_RECOVERY" && user) setRecovery(true);
        if (initialized.current && nextOwner === owner.current) return;
        initialized.current = true;
        owner.current = nextOwner;
        setSignedIn(Boolean(nextOwner));
        setBookId(""); setAllSheets(true); setAllCurrencies(true); setPeriodMode("month");
        setPreferredCurrency(defaultCurrency);
        setFilters({ search: "", kind: "", account: "" });
        setPersonFilter(undefined);
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
    } catch { setProblem("Couldn’t connect to Finance Studio. Try again in a moment."); setLoading(false); }
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
  function selectSheet(id: string) {
    setAllSheets(id === "all");
    if (id !== "all") setBookId(id);
    setFilters({ search: "", kind: "", account: "" });
  }
  function openEntry(kind?: Kind, investment?: string, bulk?: boolean) {
    if (!bookData.accounts.some(account => !account.archived && account.kind !== "investment")) {
      navigate("settings");
      setNotice("Add a bank account, wallet or cash balance to record your first entry.");
      setPanel({ type: "manage", edit: { collection: "accounts" } });
      return;
    }
    setPanel({ type: "entry", kind, preset: investment, bulk });
  }
  function openActivity(row: Activity) {
    const sourceSheet = data.accounts.find(account => account.id === row.accountId)?.ledger_id ?? "";
    setBookId(sourceSheet);
    if (row.entry) setPanel({ type: "entry", original: row.entry });
    else if (row.receipt) setPanel({ type: "receipt", receipt: row.receipt });
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
    if (dataRef.current.reimbursement_receipts.some(row => row.expense_id === entry.id || row.income_entry_id === entry.id)) {
      throw Error("Remove or unlink the associated reimbursement payments before deleting this entry.");
    }
    await removeRecord("transactions", entry.id, "Entry deleted");
  }
  async function removeRecord(collection: "transactions" | "reimbursement_receipts", id: string, message: string, paymentGroup?: string) {
    if (saving.current) throw Error("Another change is being saved. Try again in a moment.");
    const currentOwner = owner.current;
    if (configured && !currentOwner) throw Error("Sign in before deleting.");
    saving.current = true;
    try {
      if (cloud && currentOwner) await deleteCloud(getSupabase(cloud), currentOwner, collection, id, paymentGroup);
      if (currentOwner !== owner.current) throw Error("Your account changed while deleting.");
      const next = { ...dataRef.current, [collection]: dataRef.current[collection].filter(row =>
        paymentGroup ? !("payment_group_id" in row && row.payment_group_id === paymentGroup) : row.id !== id) };
      if (!configured) writeDemo(next);
      update(next);
      setNotice(message);
    } finally { saving.current = false; }
  }
  const currentReceipt = panel?.type === "receipt" || panel?.type === "delete-receipt" ? panel.receipt : null;
  const paymentRows = currentReceipt ? data.reimbursement_receipts.filter(row => paymentKey(row) === paymentKey(currentReceipt)) : [];
  const paymentAmount = paymentRows.reduce((sum, row) => sum + row.amount_minor, 0);
  const groupedPayment = paymentRows.length > 1;
  const receiptExpense = currentReceipt && data.transactions.find(entry => entry.id === currentReceipt.expense_id);
  const receiptPerson = receiptExpense && currentReceipt && entryClaims(receiptExpense).find(person => person.id === (currentReceipt.claim_id ?? receiptExpense.id));
  async function removeGoal(goal: SavingsGoal) {
    if (saving.current) throw Error("Another change is being saved. Try again in a moment.");
    const currentOwner = owner.current;
    if (configured && !currentOwner) throw Error("Sign in before deleting.");
    saving.current = true;
    try {
      if (cloud && currentOwner) await deleteCloud(getSupabase(cloud), currentOwner, "savings_goals", goal.id);
      if (currentOwner !== owner.current) throw Error("Your account changed while deleting.");
      const next = { ...dataRef.current, savings_goals: dataRef.current.savings_goals.filter(row => row.id !== goal.id) };
      if (!configured) writeDemo(next);
      update(next);
      setNotice("Goal removed");
    } finally { saving.current = false; }
  }
  async function moveField(field: Definition, direction: number) {
    const ordered = activeFields(bookData);
    const index = ordered.findIndex(row => row.id === field.id);
    const other = ordered[index + direction];
    if (!other) return;
    try { await save("field_definitions", [{ ...field, position: other.position }, { ...other, position: field.position }]); }
    catch (error) { setProblem(errorText(error)); }
  }
  async function makePdf() {
    if (exporting || route === "settings" || route === "assistant") return;
    setExporting(true); setProblem("");
    try {
      const activity = route === "transactions" && (filters.search || filters.kind || filters.account) ? filterActivity(reportData, period, filters, currency) : undefined;
      const people = route === "reimbursements" ? selectedPeople : undefined;
      await downloadStatement(reportData, period, currency, !configured, route, showingAllSheets ? "All sheets" : currentSheet.name, { activity, people });
      setNotice("Statement downloaded");
    } catch (error) { setProblem(errorText(error)); }
    finally { setExporting(false); }
  }
  async function signOut() {
    if (!cloud) return;
    try {
      const { error } = await getSupabase(cloud).auth.signOut({ scope: "local" });
      if (error) throw error;
      setShowAccess(false); setReturnError(false);
    }
    catch { setProblem("Couldn’t sign out. Try again in a moment."); }
  }

  if (cloud && (recovery || (!loading && !signedIn && !problem && showAccess))) return <AuthScreen cloud={cloud} recovery={recovery} returnError={returnError} onBack={() => { setShowAccess(false); setReturnError(false); }} onRecovered={() => { setRecovery(false); window.history.replaceState(null, "", "/"); }}/>;
  if ((!configured && !showAccess) || configured && !loading && !signedIn && !problem) return <FinanceWelcome demo={!configured} onStart={() => setShowAccess(true)}/>;
  if (configured && (loading || !signedIn || problem && data === emptyWorkspace)) return <main className="auth-screen"><section className="panel auth-panel"><Brand/>{problem ? <Empty title="Couldn’t load your records" description={problem} action={<div className="button-line"><button className="button secondary" onClick={() => window.location.reload()}>Try again</button>{signedIn && <button className="button quiet" onClick={signOut}>Sign out</button>}</div>}/> : <p role="status">Loading your records…</p>}</section></main>;

  const page = routes[route];
  const close = () => setPanel(null);
  return <div className="app-shell" data-route={route}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand/></div>
      <nav className="nav" aria-label="Finance Studio" style={{ "--selection": Object.keys(routes).indexOf(route), "--nav-count": Object.keys(routes).length } as CSSProperties}>
        <span className="nav-lens" aria-hidden="true"/>
        {Object.entries(routes).map(([key, { label, icon: Icon }]) => <a key={key} href={"#" + key} aria-current={route === key ? "page" : undefined}
          onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(key as Route); } }}>
          <Icon size={19} aria-hidden="true"/><span className="nav-label">{label}</span>
          <span className="nav-short">{key === "transactions" ? "Activity" : key === "reimbursements" ? "Claims" : key === "investments" ? "Invest" : label}</span>
        </a>)}
      </nav>
    </aside>
    <main className="main-content" id="main-content">
      <div className="page">
        <header className="page-heading" key={"heading-" + route}><div className="page-title"><h1>{page.label}</h1>{page.caption && <p>{page.caption}</p>}</div>
          <div className={"header-actions" + (reportingPage ? " reporting-actions" : "")}>
            <div className="report-sheet"><Picker label="Finance sheet" icon={Layers3} value={showingAllSheets ? "all" : currentSheet.id || personalSheet}
              options={[...(route === "overview" ? [{ value: "all", label: "All sheets" }] : []), ...sheets.map(sheet => ({ value: sheet.id || personalSheet, label: sheet.name }))]}
              onValueChange={value => selectSheet(value === personalSheet ? "" : value)}/></div>
            {reportingPage && <ReportingPeriod value={month} mode={periodMode} onChange={setMonth} onModeChange={setPeriodMode}/>}
            {reportingPage && availableCurrencies.length > 1 && <div className="report-currency"><Picker label="Reporting currency" value={showingAllCurrencies ? "all" : currency}
              options={[...(route === "overview" ? [{ value: "all", label: "All currencies" }] : []), ...availableCurrencies.map(code => ({ value: code, label: code }))]} onValueChange={code => {
                setAllCurrencies(code === "all");
                if (isCurrency(code)) setPreferredCurrency(code);
                setFilters(previous => ({ ...previous, account: "" }));
              }}/></div>}
            {reportingPage && !showingAllCurrencies && <button className="button secondary report-export" aria-label={exporting ? "Preparing PDF" : "Download PDF"} onClick={makePdf} disabled={exporting || loading}>
              <Download size={17}/><span className="desktop-export">{exporting ? "Preparing…" : "Download PDF"}</span><span className="compact-export" aria-hidden="true">{exporting ? "Saving…" : "PDF"}</span>
            </button>}
            {route === "transactions" && <button className="button secondary sheet-action" onClick={() => openEntry(undefined, undefined, true)}><Sheet size={17}/> Spreadsheet</button>}
            {route === "settings" ? <>
              <button className="button primary" onClick={() => setPanel({ type: "book" })}><Plus size={17}/> Add sheet</button>
              {currentSheet.id && <button className="button quiet" onClick={() => setPanel({ type: "book", book: currentSheet })}><Pencil size={16}/> Rename sheet</button>}
              {configured && <button className="button quiet" onClick={signOut}><LogOut size={16}/> Sign out</button>}
            </> : reportingPage && !combinedSheets && <button className="button primary" onClick={() => openEntry()}><Plus size={19}/> Add entry</button>}
          </div>
        </header>
        {problem && <div className="form-message error" role="alert"><CircleAlert size={18}/>{problem}<button className="button quiet" onClick={() => setProblem("")}>Dismiss</button></div>}
        {loading && <div className="panel"><Empty title="Opening Finance Studio" description="Loading entries and accounts…"/></div>}
        <div className="page-content" key={"content-" + route}>
          {!loading && route === "overview" && (combinedSheets || showingAllCurrencies
            ? <CombinedOverview workspace={reportBase} period={period} currencies={showingAllCurrencies ? availableCurrencies : [currency]} allSheets={combinedSheets} onOpenSheet={selectSheet}/>
            : <Overview workspace={reportData} period={period} currency={currency} onBrowse={() => navigate("transactions")} onOpen={openActivity} onAdd={() => openEntry()}/>)}
          {!loading && route === "overview" && <div className={periodMode === "month" ? "planning-grid" : "planning-grid goals-only"}>
            {periodMode === "month" && <ActivityCalendar workspace={reportBase} month={month} currency={currency} choices={showingAllCurrencies ? availableCurrencies : undefined} onOpen={openActivity}/>}
            <SavingsGoals workspace={reportBase} currencies={showingAllCurrencies || availableCurrencies.length <= 1 ? goalCurrencies : [currency]}
              onAdd={!combinedSheets && cashCurrencies.length ? () => setPanel({ type: "goal" }) : undefined}
              onEdit={goal => setPanel({ type: "goal", goal })}/>
          </div>}
          {!loading && route === "transactions" && <Transactions workspace={reportData} period={period} currency={currency} filters={filters} setFilters={setFilters} onOpen={openActivity} onAdd={() => openEntry()}/>}
          {!loading && route === "reimbursements" && <Reimbursements workspace={reportData} period={period} currency={currency} onReceive={id => setPanel({ type: "receive", id })}
            selectedPeople={selectedPeople} onPeopleChange={people => setPersonFilter({ sheet: currentSheet.id, currency, people })}
            onPayment={receipt => setPanel({ type: "receipt", receipt })}
            onOpen={id => { const entry = data.transactions.find(row => row.id === id); if (entry) setPanel({ type: "entry", original: entry }); }}/>}
          {!loading && route === "investments" && <Investments workspace={reportData} period={period} currency={currency} onEntry={openEntry} onValue={id => setPanel({ type: "value", id })} onSettings={() => navigate("settings")}/>}
          {!loading && route === "settings" && <Settings workspace={bookData} cloud={configured} onManage={edit => setPanel({ type: "manage", edit })}
            onMove={moveField} onReset={() => setPanel({ type: "reset" })} onExport={() => exportDemo(data)} onGuide={() => setPanel({ type: "guide" })}/>}
        </div>
        {!loading && <div hidden={route !== "assistant"}>
          <EntryAssistant key={currentSheet.id} workspace={bookData} currency={currency} onSave={async entry => {
            await save("transactions", [entry]); setMonth(entry.occurred_on.slice(0, 7));
            setPreferredCurrency(currencyForAccount(bookData, entry.account_id));
          }}/>
        </div>}
        <footer className="footer"><span>Finance Studio @whiteeorangee</span></footer>
      </div>
    </main>
    {panel?.type === "entry" && <EntryDialog workspace={bookData} month={month} currency={currency} original={panel.original} kind={panel.kind} preset={panel.preset} initialBulk={panel.bulk} onClose={close}
      onPayment={!panel.preset && (!panel.original || panel.original.kind === "income") ? () => setPanel({ type: "receive", incomeId: panel.original?.id }) : undefined}
      onDelete={entry => setPanel({ type: "delete", entry })} onSave={async entries => {
        await save("transactions", entries);
        if (!panel.original && entries.length === 1) { setMonth(entries[0].occurred_on.slice(0, 7)); setPreferredCurrency(currencyForAccount(bookData, entries[0].account_id)); }
      }}/>}
    {panel?.type === "guide" && <FinanceGuide close={close}/>}
    {panel?.type === "goal" && <GoalDialog goal={panel.goal} sheetId={currentSheet.id}
      currencies={panel.goal ? [panel.goal.currency] : cashCurrencies} preferred={currency} close={close}
      onSave={goal => save("savings_goals", [goal])} onDelete={goal => setPanel({ type: "delete-goal", goal })}/>}
    {panel?.type === "delete-goal" && <TaskForm title="Remove this goal?" subtitle="The set-aside amount becomes available to spend." close={close}
      submit={() => removeGoal(panel.goal)} label="Remove goal"><p className="full muted">{panel.goal.name}</p></TaskForm>}
    {panel?.type === "book" && <BookDialog book={panel.book} books={data.finance_books} close={close} onSave={async book => { await save("finance_books", [book]); selectSheet(book.id); }}/>}
    {panel?.type === "manage" && <ManagementDialog workspace={bookData} edit={panel.edit} initialCurrency={currency} close={close}
      save={(collection, rows) => save(collection, rows.map(row => ({ ...row, ledger_id: currentSheet.id || null })) as typeof rows)}/>}
    {panel?.type === "receive" && <ReceiptDialog workspace={bookData} initialClaim={panel.id} incomeId={panel.incomeId} close={close} save={async receipts => {
      await save("reimbursement_receipts", receipts);
      if (route === "reimbursements" && !inPeriod(receipts[0].received_on, period)) setMonth(receipts[0].received_on.slice(0, 7));
      setNotice(receipts[0].income_entry_id ? "Payment linked" : "Payment recorded");
    }}/>}
    {panel?.type === "value" && <ValueDialog workspace={bookData} accountId={panel.id} close={close} save={save}/>}
    {panel?.type === "delete" && <TaskForm title="Delete this entry?" subtitle={panel.entry.description + " · " + money(panel.entry.amount_minor, currencyForAccount(data, panel.entry.account_id))} close={close} submit={() => removeEntry(panel.entry)} label="Delete entry">
      <p className="full muted">This permanently removes the entry and updates the related balances.</p>
    </TaskForm>}
    {panel?.type === "receipt" && <Modal title="Reimbursement payment" subtitle={groupedPayment ? paymentRows.length + " claims" : receiptExpense?.description} onClose={close}>
      <dl className="compact-details receipt-detail">
        {!groupedPayment && receiptPerson && <div><dt>Paid by</dt><dd>{receiptPerson.counterparty}</dd></div>}
        <div><dt>Received</dt><dd>{dayLabel(panel.receipt.received_on)}</dd></div>
        <div><dt>Account</dt><dd>{accountName(data, panel.receipt.account_id)}</dd></div>
        <div><dt>Amount</dt><dd>{money(paymentAmount, currencyForAccount(data, panel.receipt.account_id))}</dd></div>
        {groupedPayment && paymentRows.map(row => {
          const expense = data.transactions.find(entry => entry.id === row.expense_id);
          const share = expense && entryClaims(expense).find(item => item.id === (row.claim_id ?? expense.id));
          return <div key={row.id}><dt>{[share?.counterparty, expense?.description].filter(Boolean).join(" · ")}</dt>
            <dd>{money(row.amount_minor, currencyForAccount(data, row.account_id))}</dd></div>;
        })}
        {panel.receipt.notes && <div><dt>Notes</dt><dd>{panel.receipt.notes}</dd></div>}
      </dl>
      <div className="modal-footer"><button className="button danger quiet push" onClick={() => setPanel({ type: "delete-receipt", receipt: panel.receipt })}>
        {panel.receipt.income_entry_id ? "Unlink payment" : "Delete payment"}
      </button><button className="button secondary" onClick={close}>Done</button></div>
    </Modal>}
    {panel?.type === "delete-receipt" && <TaskForm title={panel.receipt.income_entry_id ? "Unlink this payment?" : "Delete this payment?"}
      subtitle={money(paymentAmount, currencyForAccount(data, panel.receipt.account_id)) + (groupedPayment ? " · " + paymentRows.length + " claims" : receiptPerson ? " · " + receiptPerson.counterparty : "")}
      close={close} label={panel.receipt.income_entry_id ? "Unlink payment" : "Delete payment"}
      submit={() => removeRecord("reimbursement_receipts", panel.receipt.id, panel.receipt.income_entry_id ? "Payment unlinked" : "Payment deleted", panel.receipt.payment_group_id ?? undefined)}>
      <p className="full muted">{panel.receipt.income_entry_id
        ? "The original income entry will return to Transactions, and the amount owed will increase."
        : groupedPayment ? "This removes the whole deposit and restores the outstanding amount on each claim."
        : "The amount owed will increase. The cash balance is recalculated from the account’s tracking date."}</p>
    </TaskForm>}
    {panel?.type === "reset" && <TaskForm title="Reset demo data?" subtitle="This replaces the entries and settings saved in this browser with the original fictional data." close={close} label="Reset demo"
      submit={async () => { const fresh = createDemo(); writeDemo(fresh); update(fresh); setBookId(""); setAllSheets(true); setMonth(today().slice(0, 7)); setPersonFilter(undefined); setProblem(""); setNotice("Demo reset"); }}/>}
    {notice && <div className="toast" role="status"><ShieldCheck size={18}/>{notice}</div>}
  </div>;
}
