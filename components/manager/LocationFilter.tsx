"use client";

import { useRouter, useSearchParams } from "next/navigation";
import SingleSelect from "@/components/SingleSelect";

// Location dropdown for the dashboard Operations view — keeps other params.
export default function LocationFilter({ locations }: { locations: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const loc = params.get("loc") ?? "all";
  if (locations.length < 2) return null;

  return (
    <div className="field" style={{ minWidth: 170 }}>
      <label>Location</label>
      <SingleSelect
        value={loc}
        onChange={(v) => {
          const p = new URLSearchParams(params.toString());
          if (v === "all") p.delete("loc");
          else p.set("loc", v);
          router.replace(`/manager?${p.toString()}`, { scroll: false });
        }}
        ariaLabel="Location"
        options={[{ value: "all", label: "All locations" }, ...locations.map((l) => ({ value: l, label: l }))]}
      />
    </div>
  );
}
