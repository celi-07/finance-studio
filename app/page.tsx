import { connection } from "next/server";
import LedgerApp from "@/components/ledger-app";
import { Brand, Empty } from "@/components/ledger-ui";
import { configuredCloud } from "@/lib/ledger-cloud-config";

export default async function Home() {
  await connection();
  let cloud;
  try {
    cloud = configuredCloud({});
  } catch {
    return <main className="auth-screen"><section className="panel auth-panel"><Brand />
      <Empty title="Finance Studio can’t connect" description="Try again in a moment." />
    </section></main>;
  }
  return <LedgerApp cloud={cloud} />;
}
