import type { Metadata } from "next";
import Link from "next/link";
import { AIDemo } from "@/components/ai-demo";
import { Brand } from "@/components/ledger-ui";
export const metadata: Metadata = { title: "AI Portfolio Demo | Finance Studio", description: "Try live Gemini finance summaries, sample PDF interpretation and editable transaction previews with fictional data." };
export default function AIDemoPage() {
  return <div className="welcome"><header className="welcome-header"><Link href="/" aria-label="Finance Studio home"><Brand/></Link><Link href="/" className="button secondary">Finance Studio home</Link></header><main className="ai-demo-page"><h1>Finance Studio AI demo</h1><p className="muted">Live AI, fictional financial records, and a review step before submission.</p><AIDemo/></main><footer className="welcome-footer"><span>Finance Studio @whiteeorangee</span><Link href="/privacy">Privacy</Link></footer></div>;
}
