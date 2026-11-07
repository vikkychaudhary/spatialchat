import { useState, type FormEvent, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, ConfirmDialog, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError, api, errorMessage, setCsrf } from "../lib/api";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";
import type { Self } from "../lib/types";

const COLORS = ["#4a5bf0", "#0f9d7a", "#c2410c", "#be185d", "#7c3aed", "#0369a1", "#a16207", "#475569"];

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="glass-recessed rounded-3xl p-5"><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>;
}
function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-touch items-center justify-between gap-4 py-1.5">
      <div><label htmlFor={id} className="font-medium">{label}</label>{hint && <p id={`${id}-h`} className="text-xs text-muted">{hint}</p>}</div>
      <input id={id} type="checkbox" role="switch" checked={checked} aria-describedby={hint ? `${id}-h` : undefined} onChange={(e) => onChange(e.target.checked)} className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-line/30 transition-colors checked:bg-strong relative before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:transition-transform before:content-[''] checked:before:translate-x-5" />
    </div>
  );
}

export default function SettingsPage() {
  const { user, setUser, logout, clear } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [displayName, setName] = useState(user!.displayName);
  const [status, setStatus] = useState(user!.status);
  const [color, setColor] = useState(user!.avatarColor);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwErr, setPwErr] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delErr, setDelErr] = useState("");
  const [busy, setBusy] = useState(false);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setErrors({});
    try {
      const r = await api<{ user: Self }>("/me/profile", { method: "PATCH", body: { displayName, status, avatarColor: color } });
      setUser(r.user); toast("success", "Profile saved.");
    } catch (err) {
      const m: Record<string, string> = {};
      if (err instanceof ApiError) for (const d of err.details ?? []) m[d.field] = d.message;
      setErrors(m); if (!Object.keys(m).length) toast("error", errorMessage(err));
    }
  };
  const saveSetting = async (patch: Record<string, boolean>) => {
    try { const r = await api<{ user: Self }>("/me/settings", { method: "PATCH", body: patch }); setUser(r.user); }
    catch (err) { toast("error", errorMessage(err)); }
  };
  const desktop = async (v: boolean) => {
    if (v && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { toast("error", "Your browser blocked notifications. Allow them in site settings first."); return; }
    }
    await saveSetting({ desktopEnabled: v });
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault(); setPwErr("");
    try {
      const r = await api<{ csrfToken: string }>("/auth/change-password", { method: "POST", body: { currentPassword: pw.current, newPassword: pw.next } });
      setCsrf(r.csrfToken); setPw({ current: "", next: "" }); toast("success", "Password changed. Other devices were signed out.");
    } catch (err) { setPwErr(errorMessage(err)); }
  };
  const deleteAccount = async () => {
    setBusy(true); setDelErr("");
    try { await api("/auth/account", { method: "DELETE", body: { password: delPw } }); clear(); nav("/login", { replace: true }); }
    catch (err) { setDelErr(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <section aria-label="Settings" className="glass h-full min-h-0 overflow-y-auto overscroll-contain md:rounded-3xl">
      <div className="mx-auto max-w-2xl space-y-4 p-4 safe-t">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>

        <Card title="Profile">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="flex items-center gap-4"><Avatar name={displayName || user!.username} color={color} size={64} /><div className="text-sm text-muted">@{user!.username}<br />{user!.email}</div></div>
            <Field label="Display name" id="displayName" value={displayName} onChange={(e) => setName(e.target.value)} maxLength={50} error={errors.displayName} required />
            <Field label="Short status" id="status" value={status} onChange={(e) => setStatus(e.target.value)} maxLength={100} error={errors.status} hint="Shown to your contacts" />
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Avatar color</legend>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <label key={c} className="cursor-pointer">
                    <input type="radio" name="avatarColor" className="peer sr-only" checked={color === c} onChange={() => setColor(c)} />
                    <span className="block h-11 w-11 rounded-full ring-offset-2 ring-offset-bg0 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent" style={{ background: c }}><span className="sr-only">{c}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn-primary">Save profile</button>
          </form>
        </Card>

        <Card title="Privacy">
          <Toggle id="lastSeen" label="Show online status and last seen" hint="When off, your contacts can't see it." checked={user!.showLastSeen} onChange={(v) => void saveSetting({ showLastSeen: v })} />
        </Card>

        <Card title="Notifications">
          <Toggle id="sound" label="Play a sound for new messages" checked={user!.notifications.soundEnabled} onChange={(v) => void saveSetting({ soundEnabled: v })} />
          <Toggle id="desktop" label="Desktop notifications" hint="Shown when this tab is in the background." checked={user!.notifications.desktopEnabled} onChange={(v) => void desktop(v)} />
          <Toggle id="previews" label="Show message previews" hint="When off, notifications say “New message”." checked={user!.notifications.previewsEnabled} onChange={(v) => void saveSetting({ previewsEnabled: v })} />
        </Card>

        <Card title="Appearance">
          <label htmlFor="theme" className="mb-1.5 block text-sm font-medium">Theme</label>
          <select id="theme" className="input" value={theme} onChange={(e) => { const v = e.target.value as ThemePref; setTheme(v); setThemePref(v); }}>
            <option value="system">Match my device</option><option value="dark">Midnight (dark)</option><option value="light">Daylight (light)</option>
          </select>
        </Card>

        <Card title="Password">
          <form onSubmit={changePassword} className="space-y-4">
            {pwErr && <p role="alert" className="text-sm text-danger"><span className="font-semibold">Error: </span>{pwErr}</p>}
            <Field label="Current password" id="cur-pw" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required maxLength={128} />
            <Field label="New password" id="new-pw" type="password" autoComplete="new-password" hint="At least 10 characters. Other devices will be signed out." value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required maxLength={128} />
            <button className="btn-ghost" disabled={!pw.current || pw.next.length < 10}>Change password</button>
          </form>
        </Card>

        <Card title="Account">
          <div className="flex flex-wrap gap-3">
            <button className="btn-ghost" onClick={() => void logout().then(() => nav("/login"))}><LogOut aria-hidden className="h-4 w-4" />Sign out</button>
            <button className="btn-danger" onClick={() => setDelOpen(true)}>Delete account…</button>
          </div>
        </Card>
      </div>
      {delOpen && (
        <ConfirmDialog danger busy={busy} title="Delete your account?" confirmLabel="Delete forever" onCancel={() => { setDelOpen(false); setDelPw(""); setDelErr(""); }} onConfirm={() => void deleteAccount()}
          message="This permanently deletes your profile, contacts and every message you've sent or received. It can't be undone.">
          <div className="mt-4"><Field label="Confirm with your password" id="del-pw" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} error={delErr} /></div>
        </ConfirmDialog>
      )}
    </section>
  );
}
