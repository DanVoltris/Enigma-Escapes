// How an experience's daily start times are determined.
export type ScheduleMode = "times" | "window" | "store";

// Per-weekday booking window for "window" mode. Keys are day-of-week "0".."6"
// (0 = Sunday). A day missing or closed offers no sessions.
// A day's schedule. `times` is an explicit list for that weekday and wins when
// present — venues rarely run a clean interval all day (Alice in Wonderland's
// last two weekend slots are 75 minutes apart where the rest are 90), and the
// published times are the contract with the customer, so they are stored
// literally rather than derived.
export type DayWindow = { first: string; last: string; closed: boolean; times?: string[] };
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
  // The complete start times for one date, keyed "YYYY-MM-DD". Replaces that
  // day's usual schedule — for a day that runs a different timetable (short of
  // staff, a private hire) without touching what the weekday does every week.
  dateTimes: Record<string, string[]>;
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
  requestOnly: boolean; // starts within the request window — needs manager approval
  heldSeats: number; // seats a live request is holding; > 0 means someone got there first
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
  // Corporate events start with team building somewhere other than the room, so
  // the group arrives this many minutes before the session itself. The room is
  // only occupied from `time`, which is why nothing in the scheduling code has
  // to know about this — it is an arrival time, not a longer booking.
  leadInMinutes?: number;
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

// "none" is staff-only: a walk-in the desk hasn't taken money for yet, so the
// whole total sits as a balance due. The public checkout refuses it — see
// buildBooking — because it would let anyone book without paying.
export type PaymentOption = "full" | "deposit" | "none";

export type Promo = {
  code: string;
  percentOff: number;
  active: boolean;
};

// A payment staff recorded after booking (cash, terminal, e-transfer). The
// original online checkout amount is pricing.paidCents minus these records.
// How money was taken at the desk. A booking can hold several of these, so a
// party can split the bill across people and across methods.
export type PaymentMethod = "card" | "debit" | "cash" | "etransfer" | "giftcard" | "cheque" | "other";

export type BookingPayment = {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  payer?: string | null; // which guest paid this share, when split
  note: string | null;
  at: string; // ISO timestamp
  // Stripe PaymentIntent behind a card-reader payment. Also the idempotency
  // key: polling the same intent twice must never record it twice.
  intentId?: string | null;
  // How much of THIS payment has been given back. Held per payment, not just
  // per booking, because a party often pays on several cards and a refund has
  // to return to the card that was charged.
  refundedCents?: number;
};

export type BookingPricing = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  payments?: BookingPayment[]; // manual payment records (stored in pricing JSONB)
  // A corporate event: half an hour of team building away from the rooms, a
  // host, then the games. Both live in the pricing JSONB because the bookings
  // table has fixed columns and this needed no migration.
  //
  // flatFeeCents is charged once for the booking however many rooms it holds,
  // added to the listed price before tax and deliberately kept out of the
  // discount base: it is a cost, not a room, and a promo code shouldn't shave
  // it.
  corporate?: boolean;
  flatFeeCents?: number;
  // Gift voucher put towards this booking. voucherCents counts inside
  // paidCents — it is money the customer already handed over, not a discount.
  // voucherRedeemed guards the balance being taken more than once when the
  // Stripe return page and the webhook both finalize the same booking.
  voucherCode?: string | null;
  voucherCents?: number;
  voucherRedeemed?: boolean;
  // Stripe's id for the money taken, kept so a cancellation can refund it.
  stripePaymentIntent?: string | null;
  // Set when a booking is cancelled: what was owed back and whether Stripe
  // already returned it (false = staff still need to refund by hand).
  refundOwedCents?: number;
  refundedCents?: number;
  // How much of the checkout payment has gone back. Tracked apart from the
  // manual records because that payment isn't one of them.
  onlineRefundedCents?: number;
  refundedAt?: string | null;
  // The 20%-off reward spent on this booking, and — once the booking that
  // earned it was cancelled — the discount being taken back off it. The
  // booking is re-priced to full, so rewardOwedCents is what staff must now
  // collect on top of anything already paid.
  rewardCode?: string | null;
  rewardVoidedAt?: string | null;
  rewardOwedCents?: number;
};

// A note attached to one booking. System-written when something happens that
// staff need the reason for; the booking page shows them newest first.
export type BookingNote = {
  id: string;
  text: string;
  at: string; // ISO timestamp
  author: string; // staff name, or "System"
  editedAt?: string; // set when a staff note was rewritten after the fact
};

export type BookingSource = "online" | "in_person";

// "pending" = created for a Stripe checkout that hasn't been paid yet; it holds
// its spots until pendingExpiresAt, then stops counting against availability.
// "cancelled" frees the slot immediately and stops counting toward revenue,
// but the booking stays visible to staff so refunds can be settled.
export type BookingStatus = "paid" | "pending" | "cancelled";

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
  status: BookingStatus;
  pendingExpiresAt: string | null; // ISO; only set while status is "pending"
  gameResult: GameResult | null; // staff-recorded outcome, null until logged
  notes: BookingNote[]; // shown on the booking page, newest first
  // Which staff account took this booking. Only set for bookings made at the
  // desk — a customer booking themselves has nobody to credit.
  bookedBy?: string | null;
};

// How a session actually went — recorded by staff after the game and fed into
// per-room analytics on Reports.
export type GameResult = {
  escaped: boolean;
  timeRemainingMinutes: number | null; // minutes left on the clock (escapes)
  hintsUsed: number | null;
  notes: string;
  recordedAt: string; // ISO timestamp
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
