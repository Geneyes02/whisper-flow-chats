import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { z } from "zod";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in — Whispr" },
      { name: "description", content: "Sign in or create your Whispr account." },
    ],
  }),
});

const emailSchema = z.string().email();
const passwordSchema = z.string().min(8, "Use at least 8 characters");

function AuthPage() {
  const { mode: initialMode, redirect: redirectTo } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);

  // If already signed in, bounce to /app.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: redirectTo ?? "/app", replace: true });
    });
  }, [navigate, redirectTo]);

  function friendly(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "email_not_confirmed" || /not confirmed/i.test(raw)) {
      setShowResend(true);
      return "Please confirm your email first — check your inbox for the link.";
    }
    if (code === "invalid_credentials" || /invalid.*(login|credentials|password)/i.test(raw)) {
      return "That email and password don’t match.";
    }
    if (code === "user_already_exists" || /already registered|already exists/i.test(raw)) {
      return "An account already exists with this email. Try signing in.";
    }
    if (code === "weak_password" || /weak/i.test(raw)) {
      return "This password is too common. Pick something stronger.";
    }
    if (code === "over_email_send_rate_limit" || /rate limit/i.test(raw)) {
      return "Too many attempts — please wait a minute and try again.";
    }
    return raw || "Something went wrong.";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setShowResend(false);
    const emailParse = emailSchema.safeParse(email);
    if (!emailParse.success) return setError("Please enter a valid email address.");
    const pwParse = passwordSchema.safeParse(password);
    if (!pwParse.success) return setError(pwParse.error.issues[0]?.message ?? "Invalid password");

    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/app` },
        });
        if (err) throw err;
        setInfo("Check your inbox to confirm your email, then sign in.");
        setMode("signin");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: redirectTo ?? "/app", replace: true });
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setError(null);
    setInfo(null);
    if (!emailSchema.safeParse(email).success) {
      return setError("Enter your email address above, then tap resend.");
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/app` },
      });
      if (err) throw err;
      setInfo("Confirmation email sent. Check your inbox.");
      setShowResend(false);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      // If we came back with tokens (popup flow), navigate onward.
      if (!result.redirected) navigate({ to: redirectTo ?? "/app", replace: true });
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--electric) 30%, transparent), transparent)",
        }}
      />
      <div aria-hidden className="absolute inset-0 grid-noise opacity-[0.06]" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-16">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Whispr
        </Link>

        <div className="rise-in glass-strong rounded-3xl p-7 shadow-2xl shadow-black/40">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Whispr is private by design."
              : "Sign in to continue to Whispr."}
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={google}
            className="group mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium transition-all hover:bg-white/[0.08] hover:border-white/20 disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.5-1.7 4.4-5.5 4.4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.9 14.6 3 12 3 6.9 3 2.8 7.1 2.8 12.2S6.9 21.4 12 21.4c6.9 0 9.5-4.8 9.5-8.9 0-.6-.1-1.1-.2-1.6H12z"/>
            </svg>
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 text-sm outline-none transition-all focus:border-transparent focus:ring-focus"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <input
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 text-sm outline-none transition-all focus:border-transparent focus:ring-focus"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-lg bg-electric/10 px-3 py-2 text-sm text-muted-foreground">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New to Whispr?"}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode(mode === "signup" ? "signin" : "signup");
              }}
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Encrypted in transit and at rest.
        </p>
      </div>
    </div>
  );
}

// Prevent unused import warning for redirect (kept for future SSR guard use).
void redirect;
