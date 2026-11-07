import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { ApiError, api, errorMessage } from "../lib/api";

function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4 safe-t safe-b">
      <div className="glass-float rise w-full max-w-md rounded-[2rem] p-6 sm:p-8">
        <div aria-hidden className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-strong text-white shadow-lg"><MessageSquare className="h-6 w-6" /></div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>
        {children}
        <div className="mt-6 text-center text-sm text-muted">{footer}</div>
      </div>
    </main>
  );
}
const fieldErrors = (e: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (e instanceof ApiError) for (const d of e.details ?? []) out[d.field] = d.message;
  return out;
};
const Alert = ({ msg }: { msg: string }) => (msg ? <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm"><span className="font-semibold">Error: </span>{msg}</p> : null);

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [identifier, setId] = useState("");
  const [password, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await login(identifier, password); nav("/chats", { replace: true }); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to pick up your conversations." footer={<>New here? <Link className="font-semibold text-accent underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert msg={error} />
        <Field label="Username or email" id="identifier" value={identifier} onChange={(e) => setId(e.target.value)} autoComplete="username" required maxLength={254} />
        <Field label="Password" id="password" type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required maxLength={128} />
        <button className="btn-primary w-full" disabled={busy || !identifier || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-center text-sm"><Link className="text-accent underline" to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ username: "", email: "", displayName: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(""); setErrors({});
    try { await register({ ...f, displayName: f.displayName || undefined }); nav("/chats", { replace: true }); }
    catch (err) { setErrors(fieldErrors(err)); setError(Object.keys(fieldErrors(err)).length ? "" : errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Create your account" subtitle="Private one-to-one messaging, in real time." footer={<>Already registered? <Link className="font-semibold text-accent underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert msg={error} />
        <Field label="Username" id="username" value={f.username} onChange={set("username")} error={errors.username} hint="3-24 letters, numbers or underscores" autoComplete="username" required maxLength={24} />
        <Field label="Display name (optional)" id="displayName" value={f.displayName} onChange={set("displayName")} error={errors.displayName} autoComplete="name" maxLength={50} />
        <Field label="Email" id="email" type="email" value={f.email} onChange={set("email")} error={errors.email} autoComplete="email" required maxLength={254} />
        <Field label="Password" id="new-password" type="password" value={f.password} onChange={set("password")} error={errors.password} hint="At least 10 characters" autoComplete="new-password" required maxLength={128} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/forgot-password", { method: "POST", body: { email } }); setDone(true); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link that works once for 30 minutes." footer={<Link className="font-semibold text-accent underline" to="/login">Back to sign in</Link>}>
      {done ? (
        <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm"><span className="font-semibold">Check your inbox: </span>if that email has an account, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Alert msg={error} />
          <Field label="Email" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <button className="btn-primary w-full" disabled={busy || !email}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Remove the one-time token from the address bar/history as soon as it has been read.
  useEffect(() => { if (token) window.history.replaceState(null, "", "/reset-password"); }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/reset-password", { method: "POST", body: { token, password } }); setDone(true); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out of all devices." footer={<Link className="font-semibold text-accent underline" to="/login">Back to sign in</Link>}>
      {done ? (
        <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm"><span className="font-semibold">Password updated: </span>you can sign in now.</p>
      ) : !token ? (
        <Alert msg="This reset link is missing its token. Request a new one." />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Alert msg={error} />
          <Field label="New password" id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters" autoComplete="new-password" required maxLength={128} />
          <button className="btn-primary w-full" disabled={busy || password.length < 10}>{busy ? "Saving…" : "Save new password"}</button>
        </form>
      )}
    </AuthCard>
  );
}
