# Finance Studio

Finance Studio tracks income, spending, cash movement, reimbursements and investments across 20 currencies. Monthly reporting uses Asia/Jakarta dates.

## Run the demo

From this folder, run **npm ci** and **npm run dev**. Open the local address printed by the development server.

Leave the Supabase settings blank to use the demo. The sample entries are fictional. Changes in this mode stay in the current browser. Use Settings → Demo data to export demo data as JSON or reset it. To download an A4 statement, choose a reporting period and currency and select **Download PDF**. Overview exports the full financial report. Transactions exports a cash ledger with opening and closing balances. Reimbursements exports claims and payments, and Investments exports holdings, movements, and valuations. On Transactions, active filters limit the line items and entry details. Running balances and the summary still cover the full selected period and currency.

## Connect Supabase

1. Create a [Supabase project](https://supabase.com/dashboard/new).
2. In that project's **SQL Editor**, apply the migrations in order on a fresh database. Apply only pending migrations on an existing installation. [001 · Initial schema](supabase/migrations/001_initial.sql) · [002 · Account currencies](supabase/migrations/002_account_currencies.sql) · [003 · Finance sheets](supabase/migrations/003_finance_sheets.sql) · [004 · Historical entries and savings goals](supabase/migrations/004_history_and_savings_goals.sql) · [005 · Split reimbursements](supabase/migrations/005_split_reimbursements.sql) · [006 · Historical reimbursement payments](supabase/migrations/006_historical_reimbursement_payments.sql) · [007 · Combined reimbursement payments](supabase/migrations/007_combined_reimbursement_payments.sql) · [008 · Saved reimbursement people](supabase/migrations/008_reimbursement_people.sql). Apply pending migrations before deploying this release.
3. In **Authentication → URL Configuration**, set **Site URL** to your final site origin. Add the exact site root to the redirect allowlist. While email sign-in is active, also allow the recovery URL. This installation uses the following URLs.
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/**
   - **https://jason-finance-studio.convivialsorrel2.chatgpt.site/?recover=1**
   
   To test locally, also allow **http://127.0.0.1:4173/** and **http://127.0.0.1:4173/?recover=1** and run the dev server on port 4173. Adjust the allowlist to match the actual local port. With email confirmation enabled, open the link in the same browser and browser profile that initiated signup. Use that same browser for password reset links, which open a screen to set the new password. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Password recovery documentation](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
4. Copy [.env.example](.env.example) to **.env.local** in this folder. Fill in **NEXT_PUBLIC_SUPABASE_URL** with the project URL and **NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY** with the publishable key. Both are browser configuration. The older public **anon** key also works. Keep the secret and service-role keys out of the app. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
5. Restart the development server to test the local configuration. For the hosted site, add **SUPABASE_URL** and **SUPABASE_PUBLISHABLE_KEY** in its environment settings, then publish a new deployment. The Worker reads these settings when Finance Studio opens and passes only the project URL and the browser-safe key to the browser. A production build uses **npm run build** and outputs its Worker bundle in **dist/server**.
6. Set up the sign-in providers below. Then open the site and sign in. In **Settings**, add a financial account with its currency, opening date and balance, then record an entry. Configure categories and custom fields there as needed.

Private Site access and Finance Studio sign-in are separate. Database policies restrict authenticated users to their own financial records. To verify the connection, use two Supabase accounts in separate browser profiles. Create accounts and entries in each, confirm the other account's records are absent, and sign out to verify that Finance Studio returns to sign-in. For API-level isolation checks, use user tokens to attempt cross-owner reads, changes and links.

## Set up Google and Apple sign-in

1. In the [Supabase authentication dashboard](https://supabase.com/dashboard/project/tobethdsotahhjgsnmnt/auth/providers), open **Sign In / Providers**. Use the callback URL shown there for both providers. For Finance Studio it is **https://tobethdsotahhjgsnmnt.supabase.co/auth/v1/callback**.
2. In Google Auth Platform, set up the consent screen, add your account as a test user if the app is in Testing, and create a **Web application** OAuth client. Add the Finance Studio site origin under **Authorized JavaScript origins** and the Supabase callback URL under **Authorized redirect URIs**. Enter the client ID and secret in Supabase’s Google provider settings and enable Google. [Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
3. In your Apple Developer account, enable **Sign in with Apple** on a primary App ID and associate a **Services ID** for the web app. Register **tobethdsotahhjgsnmnt.supabase.co** as a domain and add the same Supabase callback URL as a return URL. Create a Sign in with Apple key and use it to sign the Apple client secret. Enter the Services ID and signed secret in Supabase’s Apple provider settings, then enable Apple. Replace the signed secret before it expires, at most every six months. Keep the Google secret and Apple key in your provider dashboards or secret store. [Apple sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple)
4. Set the hosting environment variable **FINANCE_AUTH_MODE=transition** to show Google, Apple and email sign-in together. Test the new sign-in methods in a separate browser profile. For an existing Finance Studio account, test with a provider that supplies the same verified email, and confirm the original sheets appear. Apple’s Hide My Email may send a relay address and open a separate account. [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
5. Once you have verified that the intended provider sign-ins work and you can reach your existing records, set **FINANCE_AUTH_MODE=oauth** and disable the Email provider in Supabase. These settings switch the site and the authentication endpoint to provider-only access.

Finance Studio uses a browser session that refreshes while valid. Google and Apple handle their own passwords and decide when to require verification. Sign out after using a shared browser. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

To launch Google alongside email before Apple is ready, enable **Google** in the connected Supabase project, set **FINANCE_AUTH_MODE=google** in your hosting settings, and redeploy. Add your exact production URL to the Supabase redirect allowlist. If you use a Google test project, add your account as a test user. After signing in, check that your existing sheets appear before retiring any sign-in method.

## Brand verification emails

1. In Supabase **Authentication → Email → SMTP Settings**, configure a transactional SMTP provider using a verified sender domain. Set the sender name to **Finance Studio** and use a mailbox on your domain, such as `accounts@your-domain.example`. Enter SMTP credentials in the dashboard. [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
2. In **Authentication → Email Templates → Confirm signup**, use the subject **Verify your Finance Studio email** and paste the [confirmation template](supabase/templates/confirm-signup.html). Replace **YOUR_PUBLIC_SITE_ORIGIN** with an HTTPS origin where **/email-logo.png** is publicly accessible. The template retains Supabase's verification link variable. [Email template variables](https://supabase.com/docs/guides/auth/auth-email-templates)
3. Send a test registration to a mailbox you control. Confirm the sender name, logo and link appear as intended. For a branded link hostname, configure a custom auth domain separately.

## How totals work

- In **Settings**, use **Add sheet** to keep records for a business, personal budget or investments separate. Each sheet has its own accounts, categories and custom fields. Use **All sheets** in Overview to see them together.
- Choose an account currency when creating the account. Entry forms follow the selected account’s currency. Choose **All currencies** in Overview to see totals side by side, or select a currency to see its details and export a PDF. Transfers, investment movements and reimbursements link accounts in the same sheet and currency.
- Account openings affect balances. Income and spending totals come from dated transactions.
- Entries before an account's tracking date appear in monthly reports and the activity calendar. The entry does not change that account's tracked balance. For a transfer or investment movement, the rule is applied to each account independently.
- Savings goals are allocations within a sheet and currency. **Available to spend** is today's tracked cash less the amounts set aside. A goal never changes your transaction history or bank balance. Update the set-aside amount as you save, and remove the goal to release that allocation.
- Transfers between cash accounts leave aggregate cash unchanged. Investment contributions and withdrawals move value between cash and investment accounts.
- Reimbursable expenses reduce cash by the amount paid. Personal spending is the share that belongs to you. Receipts add cash and reduce the open claim separately.
- Investment estimates use the last manually entered end-of-day valuation plus later contributions minus later withdrawals. Until you enter a valuation, the contributed balance supplies the estimate.
- PDFs are generated in the browser with [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans). DejaVu Sans supplies fallback glyphs for scripts such as Greek and Cyrillic. For characters outside both fonts’ glyph sets, the original text remains in Finance Studio.

## Spreadsheet entry

Choose **Add entry → Spreadsheet** or use **Spreadsheet** on Transactions. Paste from Excel or Sheets into the first matching cell. Core columns are Date, Type, Description, Amount, Account and Category. The destination, reimbursement, notes and custom field columns follow. Use **YYYY-MM-DD** or **DD/MM/YYYY**, account and category names from the selected sheet, and each account’s currency for its amount. For example, enter **125.000,50** in IDR and **125,000.50** in USD. Each used row requires Date, Type, Description, Amount, and Account. Blank rows are skipped. Transfers need a destination, and reimbursable expenses need a payer. Custom fields are optional in spreadsheet entry. The whole batch stays open for correction when any row is invalid.

The grid opens with one blank row. Use **Add row** for one more, or the arrow beside it to add a batch. Type into cells, paste from a spreadsheet, or use the controls inside cells to choose dates and listed options. Hover over a column heading for an explanation. To fill multiple columns down together, Shift-click a range or Ctrl-click (Command-click on Mac) individual cells in the same row, then drag the corner of a selected cell. Use **Ctrl+D** or **Command+D** to copy from the row above. The Destination picker is available for transfers and investment movements.

For expenses, the form offers **None**, **Partial**, and **Full** reimbursement. In the spreadsheet, use **Reimbursement (optional)** for the amount owed back and **Amount** for the entire expense. Leave **Due date** blank when there is no deadline.

Use **Assistant** to draft one income or expense in plain language. Try **Beli nasi goreng Rp47.900 tanggal 3 Okt 2026**, then send **pakai BCA** or edit the preview directly. The browser uses local rules to prepare the draft. Select **Submit transaction** to save it.

Use **Month**, **Year**, or **All time** to set the reporting period on Overview, Transactions, Reimbursements, and Investments. The PDF uses the same period. The activity calendar appears in Month view. Savings goals show cash and allocations as of today.
