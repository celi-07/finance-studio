import { env } from "cloudflare:workers";
import { connection } from "next/server";
import LedgerApp from "@/components/ledger-app";
import { Brand, Empty } from "@/components/ledger-ui";
import { readCloudConfig } from "@/lib/ledger-cloud-config";

export default async function Home() {
  await connection();
  try {
    const hasWorkerSettings = Boolean(env.SUPABASE_URL?.trim() || env.SUPABASE_PUBLISHABLE_KEY?.trim());
    const cloud = hasWorkerSettings
      ? readCloudConfig(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY)
      : readCloudConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return <LedgerApp cloud={cloud}/>;
  } catch {
    return <main className="auth-screen"><section className="panel auth-panel"><Brand/>
      <Empty title="Ledger can’t connect" description="Check the Supabase project URL and publishable key in Ledger’s settings."/>
    </section></main>;
  }
}
