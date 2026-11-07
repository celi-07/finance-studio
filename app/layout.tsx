import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger · Personal Finance",
  description: "A personal finance workspace for spending, reimbursements and investments in Indonesian rupiah.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
