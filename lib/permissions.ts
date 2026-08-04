// The permission model — pure data, no database imports, so client components
// (the Team editor, the nav) can use it without dragging server-only modules
// into the browser bundle. lib/staff.ts re-exports these for server code.

export type StaffRole = "admin" | "manager" | "clerk";

export const PERMISSIONS = [
  "calendar",
  "bookings.view",
  "bookings.create",
  "bookings.modify",
  "requests",
  "customers.view",
  "customers.export",
  "experiences",
  "promos",
  "blocks",
  "reports",
  "checklists",
  "notes",
  "settings",
  "staff",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  calendar: "View calendar & today's sessions",
  "bookings.view": "View bookings",
  "bookings.create": "Take bookings (walk-ins)",
  "bookings.modify": "Edit bookings — payments, no-shows, game results",
  requests: "Approve or decline booking requests",
  "customers.view": "View customer details",
  "customers.export": "Export / download customer lists",
  experiences: "Manage experiences (rooms, prices, schedules)",
  promos: "Manage promo codes",
  blocks: "Block off hours",
  reports: "View reports & revenue analytics",
  checklists: "Use daily checklists",
  notes: "Use the shared notes board",
  settings: "Change business & booking-site settings",
  staff: "Manage staff accounts and their access",
};

// Front desk runs their store day to day: bookings, requests, blocking hours,
// room info and performance. Held back: exporting customer lists, promo codes,
// business/payment settings and staff administration.
const CLERK_PERMISSIONS: Permission[] = [
  "calendar",
  "bookings.view",
  "bookings.create",
  "bookings.modify",
  "requests",
  "customers.view",
  "experiences",
  "blocks",
  "reports",
  "checklists",
  "notes",
];

// Manager gets everything except staff administration; admin gets the lot.
const MANAGER_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => p !== "staff");

export function defaultPermissionsFor(role: StaffRole): Permission[] {
  if (role === "admin") return [...PERMISSIONS];
  if (role === "manager") return [...MANAGER_PERMISSIONS];
  return [...CLERK_PERMISSIONS];
}

// The account shape as far as the UI is concerned (no password material).
export type StaffAccount = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  locations: string[]; // empty = every location
  permissions: Permission[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};
