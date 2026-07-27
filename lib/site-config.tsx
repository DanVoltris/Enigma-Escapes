"use client";

import { createContext, useContext } from "react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "./site-settings-defaults";

// Booking-site settings are loaded server-side in the site layout and handed to
// client components (the availability page, the cart) through this context.
const SiteConfigContext = createContext<SiteSettings>(DEFAULT_SITE_SETTINGS);

export function SiteConfigProvider({ value, children }: { value: SiteSettings; children: React.ReactNode }) {
  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig(): SiteSettings {
  return useContext(SiteConfigContext);
}
