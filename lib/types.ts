// How an experience's daily start times are determined.
export type ScheduleMode = "times" | "window" | "store";

// Per-weekday booking window for "window" mode. Keys are day-of-week "0".."6"
// (0 = Sunday). A day missing or closed offers no sessions.
export type DayWindow = { first: string; last: string; closed: boolean };
export type Windows = Record<string, DayWindow>;

// Per-weekday opening hours for a location ("store" mode source).
export type DayHours = { open: string; close: string; closed: boolean };
export type LocationHours = { location: string; hours: Record<string, DayHours> };

export type Experience = {
  id: string;
  name: string;
  location: string;
  tagline: string;
  description: string;
  durationMinutes: number;
  capacity: number;
  priceCents: number;
  minParty: number; // smallest party per booking (online); staff walk-ins can go lower
  maxParty: number; // largest party per booking (<= capacity)
  isPrivate: boolean; // one booking per time slot (whole game is exclusive)
  depositPercent: number; // deposit required for this experience (0-100; 100 = full payment)
  scheduleMode: ScheduleMode;
  times: string[]; // "times" mode: explicit 24h "HH:MM" starts, every day
  intervalMinutes: number; // "window"/"store" modes: minutes between starts
  windows: Windows; // "window" mode: per-weekday first/last start
  badgeBg: string;
  badgeFg: string;
  imageUrl: string | null; // poster image; when set, shown instead of the colour block
  active: boolean;
  sort: number;
};

export type Tax = {
  id: string;
  name: string;
  percent: number;
  active: boolean;
  sort: number;
};

export type Slot = {
  roomId: string;
  roomName: string;
  location: string;
  tagline: string;
  description: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
  capacity: number;
  remaining: number;
  priceCents: number;
  minParty: number;
  maxParty: number;
  isPrivate: boolean;
  depositPercent: number;
  badgeBg: string;
  badgeFg: string;
  imageUrl: string | null;
};

export type CartItem = {
  roomId: string;
  roomName: string;
  location: string;
  date: string;
  time: string;
  quantity: number;
  priceCents: number;
  durationMinutes: number;
  depositPercent: number; // carried from the experience so totals can blend deposits
  badgeBg: string;
  badgeFg: string;
};

export type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subscribe: boolean;
  participants?: Participant[]; // extra guests staff attach to the booking
};

// A guest attached to a booking beyond the primary customer. Stored inside the
// booking's customer JSONB (no separate table yet).
export type Participant = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  addedAt: string; // ISO timestamp
};

export type PaymentOption = "full" | "deposit";

export type Promo = {
  code: string;
  percentOff: number;
  active: boolean;
};

// A payment staff recorded after booking (cash, terminal, e-transfer). The
// original online checkout amount is pricing.paidCents minus these records.
export type BookingPayment = {
  id: string;
  method: "cash" | "card" | "etransfer" | "other";
  amountCents: number;
  note: string | null;
  at: string; // ISO timestamp
};

export type BookingPricing = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  payments?: BookingPayment[]; // manual payment records (stored in pricing JSONB)
};

export type BookingSource = "online" | "in_person";

export type Booking = {
  id: string;
  reference: string;
  createdAt: string; // ISO timestamp
  customer: Customer;
  items: CartItem[];
  promoCode: string | null;
  paymentOption: PaymentOption;
  pricing: BookingPricing;
  source: BookingSource; // "online" = customer self-served; "in_person" = staff walk-in
  noShow: boolean; // party did not turn up
};

export type StaffNote = {
  id: string;
  note: string;
  createdAt: string;
};

export type ActivityEntry = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
};
