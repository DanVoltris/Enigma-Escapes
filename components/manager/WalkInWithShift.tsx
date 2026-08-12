"use client";

import { useState } from "react";
import Link from "next/link";
import WalkInForm from "@/components/manager/WalkInForm";
import { formatDuration } from "@/lib/staff-types";

export type ShiftPerson = {
  memberId: string;
  name: string;
  location: string;
  minutes: number;
  rooms: { id: string; name: string }[];
};

// The on-shift panel and the booking form share one piece of state: the
// experience being booked. Picking a room bolds the people who can run it, so
// the desk can see at a glance whether anyone on site is signed off for it.
export default function WalkInWithShift({ people }: { people: ShiftPerson[] }) {
  const [roomId, setRoomId] = useState("");

  const byLocation = people.reduce<Record<string, ShiftPerson[]>>((acc, p) => {
    (acc[p.location] ??= []).push(p);
    return acc;
  }, {});
  const locations = Object.keys(byLocation).sort();
  const trainedCount = roomId ? people.filter((p) => p.rooms.some((r) => r.id === roomId)).length : 0;
  const chosen = roomId ? people.flatMap((p) => p.rooms).find((r) => r.id === roomId) : undefined;

  return (
    <>
      <div className="mgr-card">
        <h2>On shift now</h2>
        {people.length === 0 ? (
          <p className="mgr-empty">
            Nobody is checked in. <Link href="/manager/staff">Check in on the Staff tab</Link>.
          </p>
        ) : (
          <>
            {roomId && (
              <p className={`card-sub${trainedCount === 0 ? " warn" : ""}`}>
                {trainedCount === 0
                  ? `Nobody on shift is trained for ${chosen?.name ?? "that room"}.`
                  : `${trainedCount} on shift ${trainedCount === 1 ? "is" : "are"} trained for ${chosen?.name ?? "that room"}.`}
              </p>
            )}
            <div className="onshift-cols">
              {locations.map((loc) => (
                <div key={loc}>
                  <h3 className="intg-subhead">{loc}</h3>
                  <ul className="shift-list compact">
                    {byLocation[loc].map((p) => {
                      const can = p.rooms.some((r) => r.id === roomId);
                      return (
                        <li key={p.memberId} className={roomId && !can ? "untrained" : undefined}>
                          <span className="who">{p.name}</span>
                          <span className="rooms">
                            {p.rooms.length === 0
                              ? "no rooms recorded"
                              : p.rooms.map((r, i) => (
                                  <span key={r.id}>
                                    {i > 0 && ", "}
                                    {r.id === roomId ? <strong className="trained">{r.name}</strong> : r.name}
                                  </span>
                                ))}
                          </span>
                          <span className="mins">{formatDuration(p.minutes)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <WalkInForm onRoomChange={setRoomId} />
    </>
  );
}
