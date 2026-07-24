import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getPrivacySnapshot, requestAccountDeletion } from "@/lib/privacy.functions";
import { revokeSession, revokeDevice } from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/privacy-dashboard")({
  component: PrivacyDashboardPage,
  head: () => ({
    meta: [
      { title: "Your privacy — Whispr" },
      {
        name: "description",
        content:
          "Exactly what Whispr stores about you, in plain English. Revoke devices, revoke sessions, request account deletion.",
      },
    ],
  }),
});

function PrivacyDashboardPage() {
  const qc = useQueryClient();
  const snapshotFn = useServerFn(getPrivacySnapshot);
  const revokeSessionFn = useServerFn(revokeSession);
  const revokeDeviceFn = useServerFn(revokeDevice);
  const requestDeletionFn = useServerFn(requestAccountDeletion);

  const snap = useQuery({ queryKey: ["privacy-snapshot"], queryFn: () => snapshotFn() });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const revokeSessionMut = useMutation({
    mutationFn: (sessionId: string) => revokeSessionFn({ data: { sessionId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-snapshot"] }),
  });
  const revokeDeviceMut = useMutation({
    mutationFn: (deviceId: string) => revokeDeviceFn({ data: { deviceId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-snapshot"] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => requestDeletionFn(),
    onSuccess: () => {
      setFlash("Deletion requested. We'll email confirmation and complete removal within 30 days.");
      qc.invalidateQueries({ queryKey: ["privacy-snapshot"] });
    },
  });

  const data = snap.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/app" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to Whispr
          </Link>
          <Link to="/security" className="text-sm text-electric hover:underline">
            Security overview
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-electric">Privacy</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
          Everything Whispr stores about you.
        </h1>
        <p className="mt-4 text-muted-foreground">
          This is a live view — read directly from the database, not a marketing summary.
        </p>

        {snap.isLoading && (
          <div className="mt-10 rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
            Loading your data…
          </div>
        )}

        {data && (
          <>
            <Section title="Public profile" desc="Visible to people you talk with.">
              <KV k="Display name" v={data.profile?.display_name ?? "—"} />
              <KV k="Bio" v={data.profile?.bio ?? "—"} />
              <KV
                k="Discoverable by username"
                v={data.profile?.discoverable ? "Yes" : "No"}
              />
              <KV
                k="Account created"
                v={data.profile?.created_at ? fmtDate(data.profile.created_at) : "—"}
              />
              {data.usernames.map((u) => (
                <KV key={u.username} k="Username" v={`@${u.username}`} />
              ))}
            </Section>

            <Section
              title="Private account details"
              desc="Only you and Whispr operators (under strict audit) can see this."
            >
              <KV k="Recovery email" v={data.privateAccount?.recovery_email ?? "—"} />
              <KV k="Phone" v={data.privateAccount?.phone_number ?? "—"} />

            </Section>

            <Section
              title="Devices"
              desc="Each device holds its own session. Revoke any you don't recognise."
            >
              {data.devices.length === 0 && <Empty>No devices registered yet.</Empty>}
              {data.devices.map((d) => (
                <Row
                  key={d.id}
                  title={d.name ?? d.platform ?? "Unknown device"}
                  subtitle={`Last active ${d.last_active_at ? fmtRel(d.last_active_at) : "never"}`}
                  action={
                    <button
                      onClick={() => revokeDeviceMut.mutate(d.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-500/50 hover:text-red-400"
                    >
                      Revoke
                    </button>
                  }
                />
              ))}
            </Section>

            <Section title="Active sessions" desc="Browser or app sessions currently signed in.">
              {data.sessions.length === 0 && <Empty>No active sessions.</Empty>}
              {data.sessions.map((s) => (
                <Row
                  key={s.id}
                  title={s.user_agent ?? "Unknown client"}
                  subtitle={`Started ${fmtRel(s.started_at)} · ${s.location_hint ?? "location unknown"}`}
                  action={
                    <button
                      onClick={() => revokeSessionMut.mutate(s.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-500/50 hover:text-red-400"
                    >
                      Revoke
                    </button>
                  }
                />
              ))}
            </Section>

            <Section
              title="Activity counters"
              desc="We store aggregated counts to make the app work — never behavioural profiles."
            >
              <KV k="Conversations you're in" v={String(data.counts.conversations)} />
              <KV k="Messages you've sent" v={String(data.counts.messagesSent)} />
              <KV k="Contacts saved" v={String(data.counts.contacts)} />
              <KV k="People blocked" v={String(data.counts.blocks)} />
            </Section>

            <Section
              title="What Whispr does NOT store"
              desc="If it's not on the lists above, it isn't in our database."
            >
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• No read logs (who opened which message when).</li>
                <li>• No location tracking.</li>
                <li>• No behavioural analytics or advertising identifiers.</li>
                <li>• No contact-graph mining beyond contacts you explicitly add.</li>
                <li>• No third-party trackers on our web app.</li>
              </ul>
            </Section>

            <Section title="Delete your account" desc="Permanent. Cannot be undone.">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
                >
                  Request account deletion
                </button>
              ) : (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-5">
                  <p className="text-sm text-foreground">
                    This queues your account for deletion. All profile data, messages you sent,
                    devices and sessions will be permanently removed within 30 days. Are you sure?
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => deleteMut.mutate()}
                      disabled={deleteMut.isPending}
                      className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60"
                    >
                      {deleteMut.isPending ? "Requesting…" : "Yes, delete my account"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-border px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {flash && (
                <p className="mt-3 text-sm text-muted-foreground">{flash}</p>
              )}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-4 space-y-2 rounded-2xl border border-border bg-surface p-2">
        {children}
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function Row({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 text-sm text-muted-foreground">{children}</div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function fmtRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
