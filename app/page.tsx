import { env } from "cloudflare:workers";
import { connection } from "next/server";
import LedgerApp from "@/components/ledger-app";
import { Brand, Empty } from "@/components/ledger-ui";
import { configuredCloud } from "@/lib/ledger-cloud-config";

export default async function Home() {
  await connection();
  try {
    return <LedgerApp cloud={configuredCloud(env)}/>;
  } catch {
    return <main className="auth-screen"><section className="panel auth-panel"><Brand/>
      <Empty title="Ledger can’t connect" description="Check the Supabase project URL and publishable key in Ledger’s settings."/>
    </section></main>;
  }
}
