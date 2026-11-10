import { emptyWorkspace, newId, shiftMonth, today, type Workspace, type Account, type Category, type Entry } from "./ledger";

const storageKey = "ledger.demo.v1";
export const demoMonth = () => today().slice(0, 7);

export function createDemo(): Workspace {
  const month = demoMonth();
  const prior = shiftMonth(month, -1);
  const account = (id: string, name: string, kind: Account["kind"], opening: number): Account => ({
    id, name, kind, opening_minor: opening * 100, opening_date: prior + "-01", archived: false,
  });
  const category = (id: string, name: string, applicable_kind: Category["applicable_kind"], color: string): Category => ({ id, name, applicable_kind, color, archived: false });
  const accounts = [
    account("bank", "Main bank", "bank", 8942000), account("wallet", "Digital wallet", "wallet", 386000),
    account("reserve", "Cash reserve", "cash", 1200000), account("fund", "Index fund", "investment", 10750000),
  ];
  const categories = [
    category("food", "Food & drink", "expense", "green"), category("transport", "Transport", "expense", "blue"),
    category("home", "Home & bills", "expense", "amber"), category("shopping", "Shopping", "expense", "violet"),
    category("health", "Health", "expense", "rose"), category("salary", "Salary", "income", "green"),
    category("freelance", "Freelance", "income", "blue"), category("other", "Other income", "income", "amber"),
  ];
  const e = (id: string, date: string, description: string, value: number, overrides: Partial<Entry> = {}): Entry => ({
    id, occurred_on: date, description, amount_minor: value * 100, kind: "expense", account_id: "bank", destination_account_id: null,
    category_id: null, notes: "", reimbursable_minor: 0, counterparty: "", due_on: null, custom_values: {}, ...overrides,
  });
  const transactions = [
    e("demo1", month + "-01", "Monthly salary", 10750000, { kind: "income", category_id: "salary" }),
    e("demo2", month + "-02", "Apartment rent", 2150000, { category_id: "home" }),
    e("demo3", month + "-02", "Wallet top-up", 450000, { kind: "transfer", destination_account_id: "wallet" }),
    e("demo4", month + "-03", "Grocery run", 364500, { category_id: "food", account_id: "wallet" }),
    e("demo5", month + "-04", "Index fund contribution", 1250000, { kind: "investment_contribution", destination_account_id: "fund" }),
    e("demo6", month + "-05", "Design project", 2250000, { kind: "income", category_id: "freelance" }),
    e("demo7", month + "-06", "Team lunch", 420000, { category_id: "food", reimbursable_minor: 28000000, counterparty: "Team lunch group", due_on: month + "-24", custom_values: { reference: "Group booking" } }),
    e("demo8", month + "-07", "Train pass", 210000, { category_id: "transport", account_id: "wallet" }),
    e("demo9", month + "-07", "Desk supplies", 189000, { category_id: "shopping" }),
    e("demo10", month + "-07", "Annual checkup", 285000, { category_id: "health" }),
    e("demo11", prior + "-01", "Monthly salary", 10750000, { kind: "income", category_id: "salary" }),
    e("demo12", prior + "-02", "Apartment rent", 2150000, { category_id: "home" }),
    e("demo13", prior + "-10", "Museum tickets", 270000, { category_id: "shopping", reimbursable_minor: 13500000, counterparty: "Museum group" }),
    e("demo14", prior + "-17", "Weekend groceries", 420000, { category_id: "food" }),
    e("demo15", prior + "-20", "Book order", 240000, { category_id: "shopping", reimbursable_minor: 12000000, counterparty: "Reading club" }),
  ];
  return {
    finance_books: [], savings_goals: [], accounts, categories, transactions,
    field_definitions: [{ id: "reference", label: "Reference", field_type: "text", options: [], required: false, position: 0, archived: false }],
    reimbursement_receipts: [
      { id: "sample-payment", expense_id: "demo7", account_id: "bank", received_on: month + "-07", amount_minor: 10000000, notes: "First payment" },
      { id: "sample-settled", expense_id: "demo15", account_id: "bank", received_on: prior + "-24", amount_minor: 12000000, notes: "" },
    ],
    investment_valuations: [{ id: "sample-value", investment_account_id: "fund", valued_on: month + "-06", value_minor: 1253000000 }],
  };
}

export function readDemo(): Workspace {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    const workspace = createDemo();
    writeDemo(workspace);
    return workspace;
  }
  const envelope: unknown = JSON.parse(raw);
  if (!envelope || typeof envelope !== "object" || !("version" in envelope) || envelope.version !== 1 || !("data" in envelope)) throw Error("Demo data couldn’t be read. Reset the demo to start with a fresh copy.");
  const data = envelope.data;
  if (!data || typeof data !== "object" || !Object.keys(emptyWorkspace).every(key =>
    (key === "finance_books" || key === "savings_goals") && !(key in data) || key in data && Array.isArray((data as Record<string, unknown>)[key]))) {
    throw Error("Demo data is incomplete. Reset the demo to start with a fresh copy.");
  }
  return { ...emptyWorkspace, ...data } as Workspace;
}
export function writeDemo(workspace: Workspace) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, data: workspace }));
  } catch {
    throw Error("This browser couldn’t save the demo. Check storage permissions or available space and try again.");
  }
}
export function exportDemo(workspace: Workspace) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, data: workspace }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-studio-demo-" + newId().slice(0, 8) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
