# Ledger

Ledger is a personal finance workspace for Indonesian rupiah. It separates income, personal spending, cash movement, reimbursements and investments. Monthly reporting uses Asia/Jakarta dates.

## Run the demo

From this folder, run **npm ci** and **npm run dev**. Open the local address printed by the development server.

Leave the Supabase settings blank to use the demo. The sample entries are fictional. Changes in this mode stay in the current browser. Use Settings → Workspace to export demo data as JSON or reset the workspace. To download an A4 monthly statement, choose a month and select **Download PDF**. On Transactions, active filters limit the line items and entry details. The summary still covers the full month.

## Connect Supabase

1. Create a [Supabase project](https://supabase.com/dashboard/new).
2. In that project's **SQL Editor**, run the contents of [the initial migration](supabase/migrations/001_initial.sql) once on a fresh database. It creates Ledger's tables, owner-only row policies, owner-scoped references and accounting checks. You can also apply it with the Supabase CLI as a migration. [Row Level Security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
3. In **Authentication → Sign In / Providers**, enable email authentication. In **Authentication → URL Configuration**, set **Site URL** to your final site origin. Add its exact root and recovery URL to the redirect allowlist. For the private Ledger Site created for this project, use:
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/**
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/?recover=1**
   
   To test locally, also allow **http://127.0.0.1:4173/** and **http://127.0.0.1:4173/?recover=1** and run the dev server on port 4173. Adjust the allowlist to match the actual local port. With email confirmation enabled, open the link in the same browser and browser profile that initiated signup. Use that same browser for password reset links, which open a screen to set the new password. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Password recovery documentation](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
4. Copy [.env.example](.env.example) to **.env.local** in this folder. Fill in **NEXT_PUBLIC_SUPABASE_URL** with the project URL and **NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY** with the publishable key. Both are browser configuration. The older public **anon** key also works. Keep the secret and service-role keys out of the app. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
5. Restart the development server to test the configuration. To connect the deployed Site, rebuild with these values set and publish a new version of the same Site. A production build uses **npm run build** and outputs its Worker bundle in **dist/server**. The two settings are included in the client at build time.
6. Open the configured site and create a Ledger account. For a first workspace, go to **Settings**, add an account with its opening date and balance, then record an entry. Configure categories and custom fields there as needed. The Supabase workspace starts empty and stays separate from the browser demo.

Private Site access and the Ledger sign-in are separate. Only an authenticated Ledger user can access that user's financial records through the database. To verify the connection, use two Supabase accounts in separate browser profiles. Create accounts and entries in each, confirm the other account's records are absent, and sign out to confirm Ledger returns to sign-in. For API-level isolation checks, use user tokens to attempt cross-owner reads, changes and links. A published demo does not test the configured Supabase project or its email delivery.

## How totals work

- Account openings affect balances. Income and spending totals come from dated transactions.
- Transfers between cash accounts leave aggregate cash unchanged. Investment contributions and withdrawals move value between cash and investment accounts.
- Reimbursable expenses reduce cash by the amount paid. Personal spending is the share that belongs to you. Receipts add cash and reduce the open claim separately.
- Investment estimates use the last manually entered end-of-day valuation plus later contributions minus later withdrawals. Until you enter a valuation, the contributed balance supplies the estimate.
- PDFs are generated in the browser. The embedded DejaVu Sans font covers Latin, Greek, Cyrillic and other supported glyphs. For scripts or symbols outside its glyph set, the original text remains in Ledger.

## Spreadsheet entry

Choose **Add entry → Spreadsheet** or use **Spreadsheet** on Transactions. Paste from Excel or Sheets into the first matching cell. Core columns are Date, Type, Description, Amount, Account and Category. The destination, reimbursement, notes and custom field columns follow. Use **YYYY-MM-DD** or **DD/MM/YYYY**, account and category names, and IDR amounts such as **125.000,50**. The whole batch stays open for correction when any row is invalid.
