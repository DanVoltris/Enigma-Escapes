import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { primeLocale } from "@/lib/format";
import { getLocale } from "@/lib/locale";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Voltris Booking",
  description: "Book your escape room experience with Voltris Booking.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Load the business locale once per render and prime it for server components;
  // the inline script hands the same values to the browser before hydration so
  // client formatters match (no hydration mismatch).
  const locale = await getLocale();
  primeLocale(locale);

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `window.__LOCALE__=${JSON.stringify(locale)}` }} />
      </head>
      <body className={sourceSans.className}>{children}</body>
    </html>
  );
}
