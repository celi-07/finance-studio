import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/ledger-ui";

export const metadata: Metadata = {
  title: "Privacy Policy | Finance Studio",
  description: "How Finance Studio uses and protects your account information and financial records.",
};

export default function PrivacyPage() {
  return <div className="welcome privacy-page">
    <header className="welcome-header">
      <Link href="/" aria-label="Finance Studio home"><Brand/></Link>
    </header>
    <main className="panel privacy-policy">
      <h1>Privacy Policy</h1>
      <p className="policy-date">Last updated <time dateTime="2026-11-10">November 10, 2026</time></p>
      <p>Finance Studio is a personal finance tracker. This policy explains what happens to your account information and the financial records you choose to enter.</p>

      <section aria-labelledby="google-sign-in">
        <h2 id="google-sign-in">Google Sign-In</h2>
        <p>When you sign in with Google, Finance Studio receives your Google account identifier, email address and basic profile information, such as your name and profile photo when available. We use this information to sign you in, associate your records with your account and deliver account verification messages. Supabase processes and stores sign-in and profile information on our behalf.</p>
        <p>Finance Studio uses Google access for sign-in only. It does not read your Gmail, Drive or Calendar. We do not send your financial records to Google for sign-in, sell Google user data or use it for advertising. Our use and transfer of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
      </section>

      <section aria-labelledby="financial-records">
        <h2 id="financial-records">Financial records</h2>
        <p>Finance Studio stores the information you enter, such as account names and balances, transactions, reimbursement details, investments, goals and notes. The app uses this information to maintain your ledger and generate charts and reports. Finance Studio does not connect to banks or ask for bank login credentials.</p>
        <p>In the signed-in app, Supabase stores your records and enforces account-level access controls. In the demo, changes stay in your browser’s local storage.</p>
      </section>

      <section aria-labelledby="service-providers">
        <h2 id="service-providers">Hosting, email and browser storage</h2>
        <p>Vercel hosts the website and may process technical information such as IP addresses and request logs to run and protect the service. Our email delivery provider processes your email address and the contents of verification and other account messages it delivers. If you contact support, we use the information you send to respond.</p>
        <p>Your browser stores sign-in session information so you can stay signed in. Use Sign out to end your session or clear the site’s browser data to remove locally saved demo changes.</p>
      </section>

      <section aria-labelledby="data-choices">
        <h2 id="data-choices">Your data choices</h2>
        <p>You can review, correct and delete financial records using the app’s controls. You can also download reports. To ask about your data or request account deletion, contact Finance Studio at <a href="mailto:whiteeorangee@gmail.com">whiteeorangee@gmail.com</a>.</p>
      </section>
    </main>
    <footer className="welcome-footer"><span>Finance Studio @whiteeorangee</span><a href="mailto:whiteeorangee@gmail.com">Contact support</a></footer>
  </div>;
}
