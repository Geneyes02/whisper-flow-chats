import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/security")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: "Security & Trust — Whispr" },
      {
        name: "description",
        content:
          "Whispr's security architecture, current guarantees, roadmap to end-to-end encryption, threat model, and disclosure policy.",
      },
      { property: "og:title", content: "Security & Trust — Whispr" },
      {
        property: "og:description",
        content:
          "How Whispr protects your messages today, what we don't yet defend against, and the audited roadmap to full end-to-end encryption.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function SecurityPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-serif text-xl tracking-tight">
            Whispr
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/privacy-dashboard" className="hover:text-foreground">
              Your data
            </Link>
            <a href="mailto:security@whispr.app" className="hover:text-foreground">
              Report an issue
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-electric">
          Security & Trust
        </p>
        <h1 className="mt-4 text-balance text-5xl font-semibold tracking-[-0.02em] sm:text-6xl">
          Private by architecture — verifiable, not aspirational.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          This page documents what Whispr protects today, what it does <em>not</em> yet protect,
          and the roadmap to full end-to-end encryption. If a claim isn't on this page, we don't
          make it.
        </p>

        {/* Status pill */}
        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          <span className="font-medium">Current status:</span>
          <span className="text-muted-foreground">
            Encrypted in transit &amp; at rest. Client-side E2EE in staged rollout.
          </span>
        </div>

        {/* What we protect today */}
        <Section title="What Whispr protects today">
          <ul className="space-y-3 text-muted-foreground">
            <Li>
              <b className="text-foreground">TLS 1.3 in transit.</b> All client ↔ server traffic
              is encrypted with modern TLS.
            </Li>
            <Li>
              <b className="text-foreground">Encryption at rest.</b> Database and object storage
              are encrypted at the infrastructure layer.
            </Li>
            <Li>
              <b className="text-foreground">Row-level security.</b> Every table enforces
              per-user access rules in the database — the app cannot bypass them.
            </Li>
            <Li>
              <b className="text-foreground">Multi-device sessions.</b> Each device gets its own
              session token, revocable independently from{" "}
              <Link to="/app" className="text-electric underline-offset-4 hover:underline">
                Settings
              </Link>
              .
            </Li>
            <Li>
              <b className="text-foreground">Minimal metadata.</b> We store what's required to
              deliver messages: sender, recipient, timestamp, ciphertext, delivery status. No
              read logs. No behavioural profiling. Your{" "}
              <Link to="/privacy-dashboard" className="text-electric underline-offset-4 hover:underline">
                privacy dashboard
              </Link>{" "}
              lists every field.
            </Li>
          </ul>
        </Section>

        {/* What we do NOT yet protect */}
        <Section title="What Whispr does NOT yet protect against">
          <p className="mb-4 text-muted-foreground">
            We're being explicit so you can make an informed choice:
          </p>
          <ul className="space-y-3 text-muted-foreground">
            <Li kind="warn">
              <b className="text-foreground">Server-side access to message content.</b> Until
              client-side E2EE ships (see roadmap), a compromised server or a compelled operator
              could read message contents. Do not use Whispr for information that requires
              server-blind confidentiality yet.
            </Li>
            <Li kind="warn">
              <b className="text-foreground">Forward secrecy.</b> Not applicable until E2EE is
              live.
            </Li>
            <Li kind="warn">
              <b className="text-foreground">Metadata resistance.</b> Delivery routing metadata
              (who talks to whom, when) is visible to the server.
            </Li>
          </ul>
        </Section>

        {/* Roadmap */}
        <Section title="Roadmap to full end-to-end encryption">
          <p className="mb-6 text-muted-foreground">
            Whispr's target architecture uses the best-in-class primitive for each surface — no
            single protocol handles everything, and none of these will be labelled "encrypted"
            until they've been independently reviewed.
          </p>
          <ol className="space-y-4">
            <Roadmap
              n="01"
              title="1:1 chats — libsignal (X3DH + Double Ratchet)"
              status="Planned — Phase 1"
              body="Per-device Curve25519/Ed25519 identity keys. Prekey bundles published to the server. End-to-end encryption with forward secrecy and post-compromise recovery. Human-readable safety numbers for out-of-band device verification."
            />
            <Roadmap
              n="02"
              title="Group chats — MLS (RFC 9420)"
              status="Planned — Phase 2"
              body="Standardised group key agreement that scales to large rooms with proper forward secrecy — instead of ad-hoc shared group keys or naive sender-key designs."
            />
            <Roadmap
              n="03"
              title="Voice & video — WebRTC with SFrame"
              status="Planned — Phase 3"
              body="Insertable Streams + SFrame end-to-end media encryption. SFU / TURN servers route packets but never receive media decryption keys."
            />
            <Roadmap
              n="04"
              title="Attachments — client-side encryption before upload"
              status="Planned — Phase 4"
              body="Files are encrypted on-device before hitting object storage; the server only ever sees ciphertext blobs and routing metadata."
            />
          </ol>
          <p className="mt-6 rounded-2xl border border-border bg-surface p-5 text-sm text-muted-foreground">
            <b className="text-foreground">No silent downgrade.</b> Once a surface ships with
            E2EE enabled, it will refuse to fall back to transport-only encryption. If a peer's
            keys can't be resolved, the message doesn't send — we don't quietly weaken security
            to preserve the UX.
          </p>
        </Section>

        {/* Identity */}
        <Section title="Your identity, your keys">
          <ul className="space-y-3 text-muted-foreground">
            <Li>
              <b className="text-foreground">Per-device keys.</b> Every device holds its own
              long-lived identity keypair. Adding a device does not share private key material.
            </Li>
            <Li>
              <b className="text-foreground">Safety numbers.</b> Verify a contact's device
              fingerprint out-of-band. Ships with Phase 1.
            </Li>
            <Li>
              <b className="text-foreground">Passkeys &amp; magic links.</b> On the roadmap
              alongside username sign-in — replacing passwords where possible.
            </Li>
          </ul>
        </Section>

        {/* Open to scrutiny */}
        <Section title="Open to scrutiny">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card
              title="Report a vulnerability"
              body="We treat security researchers as partners. Please email us with a description and reproduction steps; we aim to respond within 3 business days."
              cta={{ label: "security@whispr.app", href: "mailto:security@whispr.app?subject=Security%20report" }}
            />
            <Card
              title="Bug bounty"
              body="Bounty program launches with Phase 1 E2EE. Register interest and we'll notify you when scope is published."
              cta={{ label: "Register interest", href: "mailto:security@whispr.app?subject=Bug%20bounty%20interest" }}
            />
            <Card
              title="Independent audits"
              body="Each E2EE phase ships only after independent cryptographic review. Reports will be published here on release."
            />
            <Card
              title="Disclosure policy"
              body="90-day coordinated disclosure. Critical infrastructure issues may be extended by mutual agreement. Credit given by default."
            />
          </div>
        </Section>

        <div className="mt-16 border-t border-border pt-10">
          <p className="text-sm text-muted-foreground">
            Last updated on release. See the{" "}
            <a
              href="https://github.com/whispr/whispr"
              target="_blank"
              rel="noreferrer"
              className="text-electric underline-offset-4 hover:underline"
            >
              public repository
            </a>{" "}
            for the source and change history.
          </p>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Li({ children, kind = "ok" }: { children: React.ReactNode; kind?: "ok" | "warn" }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
          kind === "warn" ? "bg-yellow-400" : "bg-electric"
        }`}
      />
      <span>{children}</span>
    </li>
  );
}

function Roadmap({
  n,
  title,
  status,
  body,
}: {
  n: string;
  title: string;
  status: string;
  body: string;
}) {
  return (
    <li className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background font-mono text-xs text-electric">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">{title}</div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {status}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
    </li>
  );
}

function Card({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="font-semibold">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {cta && (
        <a
          href={cta.href}
          className="mt-3 inline-block text-sm font-medium text-electric hover:underline"
        >
          {cta.label} →
        </a>
      )}
    </div>
  );
}
