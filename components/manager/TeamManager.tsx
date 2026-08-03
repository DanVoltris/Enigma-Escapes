"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import SingleSelect from "@/components/SingleSelect";
import {
  defaultPermissionsFor,
  PERMISSION_LABELS,
  PERMISSIONS,
  type Permission,
  type StaffAccount,
  type StaffRole,
} from "@/lib/permissions";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", manager: "Manager", clerk: "Front desk" };

type Draft = {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  locations: string[];
  permissions: Permission[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  email: "",
  password: "",
  role: "clerk",
  locations: [],
  permissions: defaultPermissionsFor("clerk"),
};

export default function TeamManager({
  initialStaff,
  locations,
  currentId,
}: {
  initialStaff: StaffAccount[];
  locations: string[];
  currentId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ role: StaffRole; locations: string[]; permissions: Permission[] } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deleting, setDeleting] = useState<StaffAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "That didn't work.");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(list: Permission[], p: Permission): Permission[] {
    return list.includes(p) ? list.filter((x) => x !== p) : [...list, p];
  }

  function toggleLocation(list: string[], l: string): string[] {
    return list.includes(l) ? list.filter((x) => x !== l) : [...list, l];
  }

  const permissionGrid = (selected: Permission[], onToggle: (p: Permission) => void) => (
    <div className="team-perms">
      {PERMISSIONS.map((p) => (
        <label key={p} className="intg-toggle" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={selected.includes(p)} onChange={() => onToggle(p)} />
          {PERMISSION_LABELS[p]}
        </label>
      ))}
    </div>
  );

  const locationPicker = (selected: string[], onToggle: (l: string) => void) => (
    <div className="mgr-form">
      <label className="field-hint" style={{ marginBottom: 4 }}>
        Locations — leave all unticked for access to every location
      </label>
      <div className="team-locs">
        {locations.map((l) => (
          <label key={l} className="intg-toggle" style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={selected.includes(l)} onChange={() => onToggle(l)} />
            {l}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {notice && <p className="promo-note ok">{notice}</p>}

      <div className="mgr-table-wrap">
        <table className="mgr-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Locations</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialStaff.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {s.id === currentId && <span className="sub"> (you)</span>}
                </td>
                <td>{s.email}</td>
                <td>{ROLE_LABEL[s.role]}</td>
                <td>{s.locations.length ? s.locations.join(", ") : "All"}</td>
                <td>
                  <span className={`mgr-pill${s.active ? " on" : ""}`}>{s.active ? "Active" : "Disabled"}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setEditingId(editingId === s.id ? null : s.id);
                      setEdit({ role: s.role, locations: [...s.locations], permissions: [...s.permissions] });
                    }}
                  >
                    {editingId === s.id ? "Close" : "Access"}
                  </button>
                  {" · "}
                  <button type="button" className="link-button" onClick={() => setResettingId(s.id)}>
                    Password
                  </button>
                  {s.id !== currentId && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => call(`/api/manager/staff/${s.id}`, "PATCH", { active: !s.active })}
                        disabled={busy}
                      >
                        {s.active ? "Disable" : "Enable"}
                      </button>
                      {" · "}
                      <button type="button" className="link-button danger" onClick={() => setDeleting(s)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingId && edit && (
        <div className="team-editor">
          <h3 className="intg-subhead">Access for {initialStaff.find((s) => s.id === editingId)?.name}</h3>
          <div className="mgr-form">
            <div className="field" style={{ maxWidth: 240 }}>
              <label>Role</label>
              <SingleSelect
                ariaLabel="Role"
                value={edit.role}
                onChange={(v) => {
                  const role = v as StaffRole;
                  setEdit({ ...edit, role, permissions: defaultPermissionsFor(role) });
                }}
                options={[
                  { value: "clerk", label: "Front desk" },
                  { value: "manager", label: "Manager" },
                  { value: "admin", label: "Admin" },
                ]}
              />
              <p className="field-hint">Changing role resets the ticks below to that role's defaults.</p>
            </div>
            {locationPicker(edit.locations, (l) => setEdit({ ...edit, locations: toggleLocation(edit.locations, l) }))}
            {permissionGrid(edit.permissions, (p) =>
              setEdit({ ...edit, permissions: togglePermission(edit.permissions, p) })
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (await call(`/api/manager/staff/${editingId}`, "PATCH", edit)) {
                    setNotice("Access updated.");
                    setEditingId(null);
                  }
                }}
              >
                {busy ? "Saving…" : "Save access"}
              </button>
              <button type="button" className="link-button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        {adding ? (
          <div className="team-editor">
            <h3 className="intg-subhead">New staff account</h3>
            <div className="mgr-form">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="st-name">Name</label>
                  <input
                    id="st-name"
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="st-email">Email (their login)</label>
                  <input
                    id="st-email"
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="st-pw">Temporary password</label>
                  <input
                    id="st-pw"
                    type="text"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  />
                  <p className="field-hint">At least 10 characters — give it to them, they can be changed later.</p>
                </div>
                <div className="field">
                  <label>Role</label>
                  <SingleSelect
                    ariaLabel="Role"
                    value={draft.role}
                    onChange={(v) => {
                      const role = v as StaffRole;
                      setDraft({ ...draft, role, permissions: defaultPermissionsFor(role) });
                    }}
                    options={[
                      { value: "clerk", label: "Front desk" },
                      { value: "manager", label: "Manager" },
                      { value: "admin", label: "Admin" },
                    ]}
                  />
                </div>
              </div>
              {locationPicker(draft.locations, (l) =>
                setDraft({ ...draft, locations: toggleLocation(draft.locations, l) })
              )}
              {permissionGrid(draft.permissions, (p) =>
                setDraft({ ...draft, permissions: togglePermission(draft.permissions, p) })
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    if (await call("/api/manager/staff", "POST", draft)) {
                      setNotice(`${draft.name} can now sign in with that email and password.`);
                      setDraft(EMPTY_DRAFT);
                      setAdding(false);
                    }
                  }}
                >
                  {busy ? "Creating…" : "Create account"}
                </button>
                <button type="button" className="link-button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add staff account
          </button>
        )}
      </div>

      <ConfirmDialog
        open={resettingId !== null}
        title="Set a new password"
        confirmLabel="Set password"
        busy={busy}
        onConfirm={async () => {
          if (await call(`/api/manager/staff/${resettingId}`, "PUT", { password: newPassword })) {
            setNotice("Password set — tell them the new one. They've been signed out everywhere.");
            setResettingId(null);
            setNewPassword("");
          }
        }}
        onCancel={() => !busy && (setResettingId(null), setNewPassword(""))}
      >
        <p>
          Type a temporary password for{" "}
          <strong>{initialStaff.find((s) => s.id === resettingId)?.name}</strong> and pass it on. It signs them out of
          every device.
        </p>
        <input
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 10 characters"
          style={{ width: "100%", marginTop: 10, padding: "10px 12px", border: "1px solid var(--border)" }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this account?"
        confirmLabel="Yes, delete"
        busy={busy}
        onConfirm={async () => {
          if (deleting && (await call(`/api/manager/staff/${deleting.id}`, "DELETE"))) {
            setNotice(`${deleting.name}'s account was deleted.`);
            setDeleting(null);
          }
        }}
        onCancel={() => !busy && setDeleting(null)}
      >
        <p>
          <strong>{deleting?.name}</strong> ({deleting?.email}) loses access immediately and permanently. Their past
          bookings and activity stay in the records.
        </p>
      </ConfirmDialog>
    </>
  );
}
