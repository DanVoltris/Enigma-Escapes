import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <Header />
      <main className="container">{children}</main>
    </CartProvider>
  );
}
