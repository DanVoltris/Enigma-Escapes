import type { Room } from "./types";

export const ROOMS: Room[] = [
  {
    id: "clockmakers-secret",
    name: "The Clockmaker's Secret",
    location: "Downtown location",
    tagline: "Book The Clockmaker's Secret.",
    description:
      "The city's master clockmaker vanished forty years ago, leaving his workshop sealed and every clock inside frozen at the same minute. Tonight the doors have opened on their own. Step inside, restart the great clock, and uncover what he was hiding before the hour strikes.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30", "19:00", "20:30"],
    badgeBg: "#0B2540",
    badgeFg: "#FFFFFF",
  },
  {
    id: "vault-77",
    name: "Vault 77",
    location: "Downtown location",
    tagline: "Book Vault 77.",
    description:
      "The First Meridian Bank has one vault that never appears on any blueprint. Your crew has sixty minutes while the alarm system reboots to crack Vault 77, empty it, and get out before the guards finish their rounds.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:15", "11:45", "13:15", "14:45", "16:15", "17:45", "19:15", "20:45"],
    badgeBg: "#2E6E91",
    badgeFg: "#FFFFFF",
  },
  {
    id: "lost-expedition",
    name: "The Lost Expedition",
    location: "Northside location",
    tagline: "Book The Lost Expedition.",
    description:
      "A research team went silent deep in the Andes, and their base camp was found abandoned with the radio still warm. Retrace their route, decode their field journals, and find out what they discovered before the storm closes in on you too.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30", "19:00", "20:30"],
    badgeBg: "#417B9E",
    badgeFg: "#FFFFFF",
  },
  {
    id: "midnight-heist",
    name: "Midnight Heist",
    location: "Northside location",
    tagline: "Book Midnight Heist.",
    description:
      "The Aurelius Diamond goes on display tomorrow morning. Tonight it sits in a private gallery protected by lasers, pressure plates, and a security chief who never sleeps. You have one hour to lift it and leave no trace.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"],
    badgeBg: "#16212B",
    badgeFg: "#FFFFFF",
  },
  {
    id: "alchemists-study",
    name: "The Alchemist's Study",
    location: "Downtown location",
    tagline: "Book The Alchemist's Study.",
    description:
      "Locked away in his tower study, the royal alchemist claimed he had found the formula for gold — then drank something that erased his memory. Piece together his experiments and finish the formula before the King's guard arrives at dawn.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:15", "11:45", "13:15", "14:45", "16:15", "17:45", "19:15", "20:45"],
    badgeBg: "#57B6F0",
    badgeFg: "#0B2540",
  },
  {
    id: "signal-from-the-deep",
    name: "Signal From the Deep",
    location: "Northside location",
    tagline: "Book Signal From the Deep.",
    description:
      "A deep-sea research station three miles down has started broadcasting a repeating signal no one can explain. Your submersible docks in sixty minutes of breathable air. Find the crew, trace the signal, and surface before the station floods.",
    durationMinutes: 60,
    capacity: 10,
    priceCents: 3000,
    times: ["10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"],
    badgeBg: "#87CEFA",
    badgeFg: "#0B2540",
  },
];

export function getRoom(id: string): Room | undefined {
  return ROOMS.find((r) => r.id === id);
}
