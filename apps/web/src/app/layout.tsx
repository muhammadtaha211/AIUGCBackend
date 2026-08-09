import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo" });

export const metadata: Metadata = {
  title: "Tavnit — מודעות וידאו מסרטון אחד",
  description: "מעלים סרטון קצר של המוצר ומקבלים כמה גרסאות של מודעת וידאו בעברית, מוכנות לפרסום.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans text-gray-100 antialiased">{children}</body>
    </html>
  );
}
