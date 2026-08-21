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
  "alerts",
  "roster",
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
  alerts: "Manage who gets texted when a booking request comes in",
  roster: "Manage the staff list and room training",
};

// Front desk is day-to-day only: the calendar, taking and editing bookings,
// answering requests, checklists and notes. Deliberately NOT theirs: blocking
// hours, revenue reports, room/pricing edits, customer records and exports,
// promo codes, settings and staff admin — those are manager/admin work.
// (Any single one can still be ticked on for an individual in Settings → Team.)
const CLERK_PERMISSIONS: Permission[] = [
  "calendar",
  "bookings.view",
  "bookings.create",
  "bookings.modify",
  "requests",
  "checklists",
  "notes",
];

// Manager runs the venue day to day but does not see what it earns: reports
// and the revenue figures gated behind them are owner business, as is staff
// administration — creating logins, setting roles and passwords.
//
// The roster and the room-training grid are a different job and stay with the
// manager: who works here and who is signed off on which room is floor
// knowledge, and it used to be locked behind account administration because the
// two shared one permission.
//
// Admin gets the lot.
const MANAGER_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => p !== "staff" && p !== "reports");

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
  phone: string | null; // where booking-request alerts go for managers/admins
};
