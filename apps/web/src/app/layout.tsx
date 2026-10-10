import type { Metadata } from "next";
import { Heebo, Secular_One } from "next/font/google";
import { NavProgress } from "@/components/nav-progress";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo" });
const secularOne = Secular_One({
  weight: "400",
  subsets: ["hebrew", "latin"],
  variable: "--font-secular",
});

export const metadata: Metadata = {
  title: "תבנית — מודעות וידאו בעברית, בלי לדעת לשווק ובלי לדעת לערוך",
  description:
    "תבנית כותבת הוקים ותסריטים בעברית מדוברת מהשאלון של העסק שלכם, ומרכיבה סרטונים אנכיים מוכנים להעלאה: הוק + דמו מהסרטון שצילמתם, סרטון עם דמות AI, או גוש טקסט על קליפ של דמות.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${secularOne.variable}`}>
      <body className="font-sans text-gray-100 antialiased">
        <NavProgress />
        {children}
      </body>
    </html>
  );
}
