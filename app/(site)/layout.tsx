import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";
import { getBusinessDetails } from "@/lib/settings";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Business details come from Settings → Business details; the footer only
  // renders once the owner has filled them in.
  const business = await getBusinessDetails()
    .then((r) => r.value)
    .catch(() => null);

  return (
    <CartProvider>
      <Header />
      <main className="container">{children}</main>
      {business?.companyName && (
        <footer className="site-footer">
          <div className="container inner">
            <strong>{business.companyName}</strong>
            {business.phone && <a href={`tel:${business.phone}`}>{business.phone}</a>}
            {business.email && <a href={`mailto:${business.email}`}>{business.email}</a>}
            {business.website && (
              <a href={business.website} target="_blank" rel="noreferrer">
                {business.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {business.taxNumber && (
              <span>
                {business.taxLabel || "Tax"} #{business.taxNumber}
              </span>
            )}
          </div>
        </footer>
      )}
    </CartProvider>
  );
}
