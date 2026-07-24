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
            Native-first messenger. Web is not an E2EE surface.
          </span>
        </div>

        {/* Platform matrix — the ONLY authoritative source */}
        <Section title="Which platforms support end-to-end encryption today">
          <p className="mb-6 text-muted-foreground">
            Whispr is a native privacy messenger. The web app onboards, documents, and
            administers your account — it is not the primary secure surface and does not
            encrypt messages end-to-end. Real E2EE ships to the native clients, one phase
            at a time, and only after the capability actually works.
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Surface</th>
                  <th className="px-4 py-3 font-medium">1:1 E2EE</th>
                  <th className="px-4 py-3 font-medium">Groups (MLS)</th>
                  <th className="px-4 py-3 font-medium">Calls</th>
                  <th className="px-4 py-3 font-medium">Attachments</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3">
                <tr>
                  <td className="font-medium text-foreground">Web (this site)</td>
                  <td>Not supported</td>
                  <td>Not supported</td>
                  <td>Not supported</td>
                  <td>Not supported</td>
                </tr>
                <tr>
                  <td className="font-medium text-foreground">macOS · Windows · Linux (Tauri)</td>
                  <td>In development — Phase A/B</td>
                  <td>Planned — Phase D</td>
                  <td>Planned — Phase E</td>
                  <td>Planned — Phase C</td>
                </tr>
                <tr>
                  <td className="font-medium text-foreground">iOS · Android</td>
                  <td>Planned after desktop</td>
                  <td>Planned — Phase D</td>
                  <td>Planned — Phase E</td>
                  <td>Planned — Phase C</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No cell is marked "supported" until it actually works on-device and passes
            Whispr's adversarial test suite. This page is the only authoritative source —
            marketing copy elsewhere is not.
          </p>
        </Section>

        {/* Web surface honesty */}
        <Section title="The web app is not an E2EE surface">
          <ul className="space-y-3 text-muted-foreground">
            <Li kind="warn">
              <b className="text-foreground">No client-side message encryption.</b> Any
              conversation preview shown in the browser is encrypted in transit (TLS 1.3)
              and at rest (infrastructure-level), but the server can technically read
              message content. Do not use the browser for information that requires
              server-blind confidentiality.
            </Li>
            <Li kind="warn">
              <b className="text-foreground">No silent downgrade.</b> A conversation created
              on a native Whispr client will not be continued in the browser as plaintext.
              The web app shows an "Open in Whispr for macOS · Windows · iOS · Android"
              state instead.
            </Li>
            <Li>
              <b className="text-foreground">Web still handles.</b> Marketing, pricing,
              this security page, your{" "}
              <Link to="/privacy-dashboard" className="text-electric underline-offset-4 hover:underline">
                privacy dashboard
              </Link>
              , account and{" "}
              <Link to="/app" className="text-electric underline-offset-4 hover:underline">
                device management
              </Link>
              ,{" "}
              <Link to="/download" className="text-electric underline-offset-4 hover:underline">
                download links
              </Link>
              , and community discovery (planned).
            </Li>
          </ul>
        </Section>

        {/* Native roadmap */}
        <Section title="Native client roadmap">
          <p className="mb-6 text-muted-foreground">
            Whispr's target architecture uses the best-in-class primitive for each surface —
            no single protocol handles everything. Each phase changes public claims only
            when the capability actually ships and has passed adversarial review.
          </p>
          <ol className="space-y-4">
            <Roadmap
              n="A"
              title="Device identity & session foundation"
              status="In development — desktop first"
              body="Tauri runtime detection, native secure key storage (macOS Keychain, Windows DPAPI, Linux SecretService), libsignal Rust bridge, device provisioning, prekey publishing, session persistence."
            />
            <Roadmap
              n="B"
              title="Real 1:1 encrypted messaging — libsignal (X3DH + Double Ratchet)"
              status="Planned — after Phase A"
              body="Real ratcheted 1:1 exchange with forward secrecy and post-compromise recovery. Offline first-contact delivery, multi-device sessions, identity-change warnings, out-of-band safety-number verification, device revocation."
            />
            <Roadmap
              n="C"
              title="Client-side encrypted attachments"
              status="Planned"
              body="Files are encrypted on-device before hitting object storage. Encrypted media metadata. Secure local media cache. Server sees only ciphertext blobs and routing metadata."
            />
            <Roadmap
              n="D"
              title="Group chats — MLS (RFC 9420)"
              status="Planned"
              body="Standardised group key agreement that scales to large rooms with proper forward secrecy — not ad-hoc shared group keys."
            />
            <Roadmap
              n="E"
              title="Voice & video — WebRTC with client-side SFrame"
              status="Planned"
              body="Insertable Streams + SFrame end-to-end media encryption. SFU / TURN servers route packets but never receive media decryption keys."
            />
          </ol>
          <p className="mt-6 rounded-2xl border border-border bg-surface p-5 text-sm text-muted-foreground">
            <b className="text-foreground">Fail closed.</b> Once a native surface ships with
            E2EE enabled, it refuses to fall back to transport-only encryption. If a peer's
            keys can't be resolved, the message doesn't send. Identity changes surface a
            high-priority security state before the new identity is treated as trusted.
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
