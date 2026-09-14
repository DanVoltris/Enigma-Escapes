import type { Metadata } from "next";
import { headers } from "next/headers";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { primeLocale } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import { getCompanyName } from "@/lib/settings";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

// The venue's name, not the software's — this is the browser tab a customer
// sees, and the two venues running this code are different businesses.
export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompanyName();
  return {
    title: company,
    description: `Book your escape room experience with ${company}.`,
    // The name under the home-screen icon. Without it iOS uses the page title,
    // which on the portal is "Manager — …" and gets cut off.
    appleWebApp: { title: company },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Load the business locale once per render and prime it for server components;
  // the inline script hands the same values to the browser before hydration so
  // client formatters match (no hydration mismatch).
  const locale = await getLocale();
  primeLocale(locale);
  // Set per request by proxy.ts; the Content-Security-Policy only lets an
  // inline script run if it carries this exact value.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en">
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__LOCALE__=${JSON.stringify(locale)}` }} />
      </head>
      <body className={sourceSans.className}>{children}</body>
    </html>
  );
}
