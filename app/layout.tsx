import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Studio",
  description: "Track spending, income, reimbursements and investments across currencies.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preload" href="/PlusJakartaSans-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous"/><link rel="preload" href="/PlusJakartaSans-Bold.ttf" as="font" type="font/ttf" crossOrigin="anonymous"/></head><body>{children}</body></html>;
}
