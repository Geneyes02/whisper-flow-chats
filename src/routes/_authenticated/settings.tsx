import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMe,
  updateMyProfile,
  claimUsername,
  listMySessions,
  revokeSession,
} from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — Whispr" },
      { name: "description", content: "Manage your Whispr profile, username, and sessions." },
    ],
  }),
});

function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const fetchSessions = useServerFn(listMySessions);
  const updateProfile = useServerFn(updateMyProfile);
  const claim = useServerFn(claimUsername);
  const revoke = useServerFn(revokeSession);

  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => fetchSessions() });

  const profile = me.data?.profile;

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Seed the form once the profile loads. Using local controlled state (not
  // defaultValue) so we can compare edits and never wipe untouched fields.
  useEffect(() => {
    if (!seeded && profile) {
      setDisplayName(profile.display_name ?? "");
      setBio(profile.bio ?? "");
      setSeeded(true);
    }
  }, [profile, seeded]);

  const claimMut = useMutation({
    mutationFn: (u: string) => claim({ data: { username: u.trim().toLowerCase() } }),
    onSuccess: (r) => {
      if (!r.ok) setFlash({ kind: "err", msg: "That username is taken. Try another." });
      else {
        setFlash({ kind: "ok", msg: "Username claimed." });
        setUsername("");
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    },
    onError: (e) => setFlash({ kind: "err", msg: e instanceof Error ? e.message : "Could not claim username." }),
  });

  const profileMut = useMutation({
    mutationFn: async (): Promise<{ ok: boolean; noop?: boolean }> => {
      // Only send fields the user actually changed. Empty strings collapse to
      // `null` for nullable columns; display_name is required so we ignore
      // an empty value instead of clearing it.
      const patch: {
        display_name?: string;
        bio?: string | null;
      } = {};
      const nextName = displayName.trim();
      if (nextName && nextName !== (profile?.display_name ?? "")) patch.display_name = nextName;
      const nextBio = bio.trim();
      if (nextBio !== (profile?.bio ?? "")) patch.bio = nextBio.length ? nextBio : null;
      if (Object.keys(patch).length === 0) return { ok: true, noop: true };
      return await updateProfile({ data: patch });
    },
    onSuccess: (r) => {
      if (r.noop) setFlash({ kind: "ok", msg: "Nothing to save." });
      else {
        setFlash({ kind: "ok", msg: "Profile saved." });
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    },
    onError: (e) =>
      setFlash({ kind: "err", msg: e instanceof Error ? e.message : "Could not save profile." }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { sessionId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--electric) 22%, transparent), transparent)",
        }}
      />

      <header className="glass sticky top-0 z-20 flex items-center justify-between px-4 py-2.5">
        <Link to="/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md avatar-gradient text-[11px]">W</span>
          Whispr
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
          >
            Back to chats
          </Link>
          <button
            onClick={signOut}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="relative mx-auto max-w-2xl px-5 py-10 md:py-14">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage how you appear on Whispr and which devices are signed in.
          </p>
        </div>

        {flash && (
          <div
            role="status"
            className={`rise-in mb-6 rounded-xl border px-3.5 py-2.5 text-sm ${
              flash.kind === "ok"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            {flash.msg}
          </div>
        )}

        {/* Username */}
        <section className="glass-strong mb-5 rounded-2xl p-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Username</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                People find you on Whispr with this handle.
              </p>
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">
              {profile?.username ? (
                <span className="text-foreground">@{profile.username}</span>
              ) : (
                <em>not set</em>
              )}
            </p>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                @
              </span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ada.lovelace"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 pl-7 pr-3 text-sm outline-none transition-all focus:border-transparent focus:ring-focus"
              />
            </div>
            <button
              disabled={claimMut.isPending || username.trim().length < 3}
              onClick={() => claimMut.mutate(username)}
              className="h-10 shrink-0 rounded-xl bg-electric px-5 text-sm font-medium text-electric-foreground shadow-lg shadow-electric/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {claimMut.isPending ? "…" : "Claim"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            3–24 characters. Letters, numbers, dots, and underscores.
          </p>
        </section>

        {/* Profile */}
        <section className="glass-strong mb-5 rounded-2xl p-6">
          <h2 className="text-base font-semibold tracking-tight">Profile</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Shown to people you chat with.
          </p>
          <div className="mt-4 grid gap-4">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Display name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 text-sm outline-none transition-all focus:border-transparent focus:ring-focus"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Bio <span className="normal-case text-muted-foreground/70">({bio.length}/240)</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={240}
                placeholder="A short line about you."
                className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-focus"
              />
            </div>
            <div>
              <button
                disabled={profileMut.isPending || !seeded}
                onClick={() => profileMut.mutate()}
                className="h-10 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {profileMut.isPending ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </section>

        {/* Sessions */}
        <section className="glass-strong mb-5 rounded-2xl p-6">
          <h2 className="text-base font-semibold tracking-tight">Active sessions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign out of any device you don&apos;t recognise.
          </p>
          <ul className="mt-4 divide-y divide-white/5">
            {sessions.isLoading && (
              <li className="py-3 text-sm text-muted-foreground">Loading sessions…</li>
            )}
            {(sessions.data ?? []).length === 0 && !sessions.isLoading && (
              <li className="py-3 text-sm text-muted-foreground">
                No tracked sessions yet. Sessions appear here as your devices register.
              </li>
            )}
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.user_agent ?? "Unknown device"}</p>
                  <p className="text-xs text-muted-foreground">
                    Last seen{" "}
                    {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : "—"}
                  </p>
                </div>
                <button
                  disabled={revokeMut.isPending}
                  onClick={() => revokeMut.mutate(s.id)}
                  className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-destructive/20 hover:text-destructive"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          Messages are encrypted in transit and at rest.
        </p>
      </main>
    </div>
  );
}
