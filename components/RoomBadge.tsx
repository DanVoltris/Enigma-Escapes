function initials(name: string): string {
  return name
    .split(" ")
    .filter((w) => /^[A-Z0-9]/i.test(w) && !["the", "of", "from", "a", "an"].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default function RoomBadge({ name, bg, fg }: { name: string; bg: string; fg: string }) {
  return (
    <span className="room-badge" style={{ background: bg, color: fg }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
