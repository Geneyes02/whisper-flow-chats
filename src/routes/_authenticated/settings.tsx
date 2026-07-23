import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMe,
  updateMyProfile,
  claimUsername,
  listMySessions,
  revokeSession,
} from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: AppHome,
  head: () => ({
    meta: [
      { title: "Your account — Whispr" },
      { name: "description", content: "Manage your Whispr profile, sessions, and devices." },
    ],
  }),
});

function AppHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const fetchSessions = useServerFn(listMySessions);
  const updateProfile = useServerFn(updateMyProfile);
  const claim = useServerFn(claimUsername);
  const revoke = useServerFn(revokeSession);

  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => fetchSessions() });

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const claimMut = useMutation({
    mutationFn: (u: string) => claim({ data: { username: u } }),
    onSuccess: (r) => {
      if (!r.ok) setMsg("Username is already taken.");
      else {
        setMsg("Username claimed.");
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    },
  });

  const profileMut = useMutation({
    mutationFn: (data: { display_name?: string; bio?: string | null }) =>
      updateProfile({ data }),
    onSuccess: () => {
      setMsg("Profile saved.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
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

  const profile = me.data?.profile;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">Whispr</Link>
          <button
            onClick={signOut}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10 space-y-10">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Whispr</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account is live. Messaging arrives in the next update — for now, set your
            profile and manage your sessions.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Security note: messages are not yet end-to-end encrypted. Content is protected in
            transit and at rest only. E2EE is coming in a follow-up release.
          </p>
        </section>

        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold">Username</h2>
          <p className="text-sm text-muted-foreground">
            Current: {profile?.username ? `@${profile.username}` : <em>not set</em>}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. ada.lovelace"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              disabled={claimMut.isPending || !username}
              onClick={() => claimMut.mutate(username)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              Claim
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="mt-3 grid gap-3">
            <div>
              <label className="text-xs font-medium">Display name</label>
              <input
                defaultValue={profile?.display_name ?? ""}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Bio</label>
              <textarea
                defaultValue={profile?.bio ?? ""}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={240}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <button
                disabled={profileMut.isPending}
                onClick={() =>
                  profileMut.mutate({
                    display_name: displayName || profile?.display_name || undefined,
                    bio: bio || null,
                  })
                }
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Save profile
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold">Active sessions</h2>
          <p className="text-sm text-muted-foreground">
            Sign out of any device you don't recognize.
          </p>
          <ul className="mt-4 divide-y divide-border">
            {(sessions.data ?? []).length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">
                No tracked sessions yet. Sessions appear here as they are registered by devices.
              </li>
            )}
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm">{s.user_agent ?? "Unknown device"}</p>
                  <p className="text-xs text-muted-foreground">
                    Last seen {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : "—"}
                  </p>
                </div>
                <button
                  disabled={revokeMut.isPending}
                  onClick={() => revokeMut.mutate(s.id)}
                  className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
