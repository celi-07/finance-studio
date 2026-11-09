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
      <Empty title="Ledger can’t connect" description="The workspace is temporarily unavailable. Try again in a moment."/>
    </section></main>;
  }
}
