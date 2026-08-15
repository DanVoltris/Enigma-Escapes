// Who gets a text when a booking request lands.
//
// Two sources, deliberately:
//
//   Managers and admins  — their number lives on their login account, and they
//                          are always texted. There is no switch: these alerts
//                          expire when the session starts, and the person who
//                          answers for the venue should not be able to mute
//                          themselves by accident. Clearing the number is how
//                          they opt out, and that is a deliberate act.
//   Everyone else        — the staff roster, each with a switch. Off keeps them
//                          on the list and skips them.
//
// Both are edited on one screen (Staff → Booking request alerts). They stay
// separate underneath because the roster is 21 people who mostly have no login,
// while the roles that must always be reachable only exist on accounts — and
// matching the two by name is exactly the kind of join that fails quietly
// ("Tali" the account vs "Tali Nudler" the roster).
import { listStaffMembers } from "./staff-members";
import { listStaff } from "./staff";

export type AlertRecipient = {
  name: string;
  phone: string;
  source: "account" | "roster";
  locked: boolean; // manager/admin — always on, no switch
};

// A number is only useful if it can be dialled. Same shape the business
// settings have always accepted, and the roster editor enforces it too.
const PHONE_RE = /^[\d\s()+-]{7,}$/;

export function phoneProblem(phone: string): string | null {
  const value = phone.trim();
  if (!value) return null; // no number is fine — it just means no texts
  if (!PHONE_RE.test(value)) return "That doesn't look like a phone number.";
  if (value.length > 30) return "That number is too long.";
  return null;
}

// Digits only, so the same person listed as "204 555 0134" on their account and
// "(204) 555-0134" on the roster is one person and gets one text.
const digits = (phone: string): string => phone.replace(/\D/g, "");

export async function alertRecipients(): Promise<AlertRecipient[]> {
  const [accounts, members] = await Promise.all([listStaff(), listStaffMembers()]);

  const out: AlertRecipient[] = [];
  for (const a of accounts) {
    if (!a.active) continue;
    if (a.role !== "admin" && a.role !== "manager") continue;
    if (!a.phone?.trim()) continue;
    out.push({ name: a.name, phone: a.phone.trim(), source: "account", locked: true });
  }
  for (const m of members) {
    if (!m.active || !m.requestAlerts) continue;
    if (!m.phone?.trim()) continue;
    out.push({ name: m.name, phone: m.phone.trim(), source: "roster", locked: false });
  }

  // Accounts win a tie: theirs is the entry that can't be switched off.
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = digits(r.phone);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
