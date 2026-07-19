export type Experience = {
  id: string;
  name: string;
  location: string;
  tagline: string;
  description: string;
  durationMinutes: number;
  capacity: number;
  priceCents: number;
  times: string[]; // 24h "HH:MM" start times offered every day
  badgeBg: string;
  badgeFg: string;
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
  badgeBg: string;
  badgeFg: string;
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
  badgeBg: string;
  badgeFg: string;
};

export type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subscribe: boolean;
};

export type PaymentOption = "full" | "deposit";

export type Promo = {
  code: string;
  percentOff: number;
  active: boolean;
};

export type BookingPricing = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
};

export type Booking = {
  id: string;
  reference: string;
  createdAt: string; // ISO timestamp
  customer: Customer;
  items: CartItem[];
  promoCode: string | null;
  paymentOption: PaymentOption;
  pricing: BookingPricing;
};
