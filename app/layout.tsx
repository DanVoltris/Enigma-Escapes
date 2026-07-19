import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Voltris Booking",
  description: "Book your escape room experience with Voltris Booking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={sourceSans.className}>
        <CartProvider>
          <Header />
          <main className="container">{children}</main>
        </CartProvider>
      </body>
    </html>
  );
}
