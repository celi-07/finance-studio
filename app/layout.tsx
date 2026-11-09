import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Studio",
  description: "Track spending, income, reimbursements and investments across currencies.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
