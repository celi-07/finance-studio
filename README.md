# Finance Studio

Finance Studio tracks income, spending, cash movement, reimbursements and investments across 20 currencies. Monthly reporting uses Asia/Jakarta dates.

## Run the demo

From this folder, run **npm ci** and **npm run dev**. Open the local address printed by the development server.

Leave the Supabase settings blank to use the demo. The sample entries are fictional. Changes in this mode stay in the current browser. Use Settings → Demo data to export demo data as JSON or reset it. To download an A4 monthly statement, choose a month and currency and select **Download PDF**. On Transactions, active filters limit the line items and entry details. The summary still covers the full month in the selected currency.

## Connect Supabase

1. Create a [Supabase project](https://supabase.com/dashboard/new).
2. In that project's **SQL Editor**, apply [the initial migration](supabase/migrations/001_initial.sql) on a fresh database, then apply [the currency migration](supabase/migrations/002_account_currencies.sql). Existing installations need only the second migration before deploying this version. It assigns IDR to existing accounts while preserving the recorded amounts and ownership policies. [Row Level Security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
3. In **Authentication → Sign In / Providers**, enable email authentication. In **Authentication → URL Configuration**, set **Site URL** to your final site origin. Add its exact root and recovery URL to the redirect allowlist. For this private Finance Studio site, use:
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/**
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/?recover=1**
   
   To test locally, also allow **http://127.0.0.1:4173/** and **http://127.0.0.1:4173/?recover=1** and run the dev server on port 4173. Adjust the allowlist to match the actual local port. With email confirmation enabled, open the link in the same browser and browser profile that initiated signup. Use that same browser for password reset links, which open a screen to set the new password. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Password recovery documentation](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
4. Copy [.env.example](.env.example) to **.env.local** in this folder. Fill in **NEXT_PUBLIC_SUPABASE_URL** with the project URL and **NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY** with the publishable key. Both are browser configuration. The older public **anon** key also works. Keep the secret and service-role keys out of the app. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
5. Restart the development server to test the local configuration. For the hosted site, add **SUPABASE_URL** and **SUPABASE_PUBLISHABLE_KEY** in its environment settings, then publish a new deployment. The Worker reads these settings when Finance Studio opens and passes only the project URL and the browser-safe key to the browser. A production build uses **npm run build** and outputs its Worker bundle in **dist/server**.
6. Open the configured site and create a Finance Studio account. In **Settings**, add a financial account with its currency, opening date and balance, then record an entry. Configure categories and custom fields there as needed.

Private Site access and Finance Studio sign-in are separate. Database policies restrict authenticated users to their own financial records. To verify the connection, use two Supabase accounts in separate browser profiles. Create accounts and entries in each, confirm the other account's records are absent, and sign out to verify that Finance Studio returns to sign-in. For API-level isolation checks, use user tokens to attempt cross-owner reads, changes and links.

## How totals work

- Choose an account currency when creating the account. When several currencies are present, use the reporting currency picker next to the month. Forms, totals and PDF exports use that currency. Transfers, investment movements and reimbursements link accounts in the same currency.
- Account openings affect balances. Income and spending totals come from dated transactions.
- Transfers between cash accounts leave aggregate cash unchanged. Investment contributions and withdrawals move value between cash and investment accounts.
- Reimbursable expenses reduce cash by the amount paid. Personal spending is the share that belongs to you. Receipts add cash and reduce the open claim separately.
- Investment estimates use the last manually entered end-of-day valuation plus later contributions minus later withdrawals. Until you enter a valuation, the contributed balance supplies the estimate.
- PDFs are generated in the browser. The embedded DejaVu Sans font covers Latin, Greek, Cyrillic and other supported glyphs. For scripts or symbols outside its glyph set, the original text remains in Finance Studio.

## Spreadsheet entry

Choose **Add entry → Spreadsheet** or use **Spreadsheet** on Transactions. Paste from Excel or Sheets into the first matching cell. Core columns are Date, Type, Description, Amount, Account and Category. The destination, reimbursement, notes and custom field columns follow. Use **YYYY-MM-DD** or **DD/MM/YYYY**, account and category names, and amounts in the selected currency. For example, enter **125.000,50** in IDR and **125,000.50** in USD. The whole batch stays open for correction when any row is invalid.
