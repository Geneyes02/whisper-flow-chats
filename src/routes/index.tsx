import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Whispr — Private messaging, beautifully done" },
      {
        name: "description",
        content:
          "Whispr is a privacy-first communication platform for messaging, calls, and communities. Fast, beautiful, reliable — designed with craft.",
      },
    ],
  }),
});

function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground overflow-x-hidden">
      <Nav />
      <main>
        <Hero />
        <LogoStrip />
        <Features />
        <ChatShowcase />
        <SecuritySection />
        <PlatformsSection />
        <Comparison />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

/* ----------------------------- NAV ----------------------------- */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "py-2" : "py-4"
      }`}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-full border border-border/60 px-4 py-2 transition-all duration-300 ${
          scrolled ? "glass shadow-2xl shadow-black/40" : "bg-transparent border-transparent"
        }`}
        style={{ marginLeft: "max(1rem, env(safe-area-inset-left))", marginRight: "max(1rem, env(safe-area-inset-right))" }}
      >
        <Link to="/" className="flex items-center gap-2 pl-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Whispr</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {[
            ["Features", "#features"],
            ["Security", "#security"],
            ["Compare", "#comparison"],
            ["Pricing", "#pricing"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>


        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="group relative inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-transform active:scale-[0.97]"
          >
            Get started
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-lg"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, oklch(0.68 0.19 255) 0%, oklch(0.5 0.22 265) 100%)",
        boxShadow: "0 4px 12px -2px color-mix(in oklab, oklch(0.62 0.19 255) 60%, transparent)",
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </span>
  );
}

/* ----------------------------- HERO ----------------------------- */

function Hero() {
  return (
    <section className="relative pt-36 pb-24 sm:pt-44 sm:pb-32">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, oklch(0.62 0.19 255 / 0.55), transparent 70%)",
          }}
        />
        <div
          className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, oklch(0.5 0.22 300 / 0.5), transparent 70%)",
          }}
        />
        <div className="absolute inset-0 opacity-[0.07] grid-noise" />
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="#security"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-electric pulse-ring" />
            Private by design — real-time, end-to-end capable
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>

          <h1 className="mt-6 text-balance text-5xl font-semibold tracking-[-0.03em] sm:text-6xl md:text-7xl">
            Private messaging,{" "}
            <span className="italic font-normal text-transparent bg-clip-text" style={{
              backgroundImage: "linear-gradient(120deg, oklch(0.985 0.002 260), oklch(0.68 0.19 255))",
              fontFamily: "var(--font-display)",
            }}>
              beautifully done.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
            Whispr brings messages, calls, and communities into one calm, fast,
            private experience — with the craft you expect from the products you love.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/download"
              className="group inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-transform active:scale-[0.98]"
            >
              Download Whispr
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </Link>

            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.02] px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06]"
            >
              See what's inside
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Free forever for individuals · Available for Mac, iOS, Android, Windows, Linux and Web
          </p>
        </div>

        <div className="relative mx-auto mt-16 max-w-5xl">
          <HeroDeviceMock />
        </div>
      </div>
    </section>
  );
}

function HeroDeviceMock() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-x-16 -inset-y-8 -z-10 rounded-[48px] opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, oklch(0.62 0.19 255 / 0.35), transparent 70%)",
        }}
      />
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-surface shadow-2xl shadow-black/60">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-border/60 bg-surface-elevated px-4 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-xs text-muted-foreground">
            <Logo size={14} />
            <span>whispr.app</span>
          </div>
          <div className="w-14" />
        </div>

        {/* app grid */}
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-[520px]">
          {/* sidebar */}
          <aside className="hidden border-r border-border/60 bg-background/40 p-3 md:block">
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-muted-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              Search or jump to…
              <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </div>
            <ChatRow name="Design Studio" preview="Ella: shipped the new icons ✨" time="now" active unread={3} />
            <ChatRow name="Mira Chen" preview="Typing…" time="2m" typing />
            <ChatRow name="Weekend Trip 🏔️" preview="Sam: I booked the cabin" time="14m" unread={12} />
            <ChatRow name="Whispr Team" preview="You: pushed to main" time="1h" />
            <ChatRow name="Mom" preview="Voice message" time="Tue" voice />
            <ChatRow name="Book Club" preview="Ash: chapter 4 discussion?" time="Wed" />
            <ChatRow name="Alex R." preview="Encrypted photo" time="Thu" />
          </aside>

          {/* thread */}
          <section className="flex flex-col bg-background">
            <header className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
              <Avatar label="DS" tone="electric" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">Design Studio</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  4 online · real-time
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                <IconBtn label="Voice call"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg></IconBtn>
                <IconBtn label="Video call"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg></IconBtn>
                <IconBtn label="More"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></IconBtn>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-hidden px-5 py-6">
              <DayLabel>Today</DayLabel>
              <Bubble from="them" name="Ella">Just finished the new call UI. Sending it over now.</Bubble>
              <Bubble from="them" media>
                <div className="relative overflow-hidden rounded-xl border border-border/70">
                  <div className="aspect-[16/10] w-64 bg-gradient-to-br from-[oklch(0.62_0.19_255)] via-[oklch(0.35_0.15_265)] to-[oklch(0.15_0.02_260)]" />
                  <div className="absolute bottom-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] backdrop-blur">call-ui-v2.png</div>
                </div>
              </Bubble>
              <Bubble from="me">Gorgeous. Ship it 🚀</Bubble>
              <Bubble from="me" reactions={[{ e: "🔥", n: 3 }, { e: "❤️", n: 2 }]}>
                Let's roll it into the 2.4 release. I'll write the notes.
              </Bubble>
              <TypingBubble />
            </div>

            <div className="border-t border-border/60 p-3">
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2">
                <button className="text-muted-foreground hover:text-foreground" aria-label="Attach">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <div className="flex-1 text-sm text-muted-foreground">Message Design Studio…</div>
                <button className="text-muted-foreground hover:text-foreground" aria-label="Emoji">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                </button>
                <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-electric text-electric-foreground" aria-label="Send">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ChatRow({
  name, preview, time, active, unread, typing, voice,
}: { name: string; preview: string; time: string; active?: boolean; unread?: number; typing?: boolean; voice?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}>
      <Avatar label={name.slice(0, 2).toUpperCase()} tone={active ? "electric" : "graphite"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-[10px] text-muted-foreground">{time}</span>
        </div>
        <div className={`flex items-center gap-1 truncate text-xs ${typing ? "text-electric" : "text-muted-foreground"}`}>
          {voice && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>}
          <span className="truncate">{preview}</span>
        </div>
      </div>
      {unread ? (
        <span className="rounded-full bg-electric px-1.5 py-0.5 text-[10px] font-semibold text-electric-foreground">{unread}</span>
      ) : null}
    </div>
  );
}

function Avatar({ label, tone = "graphite" }: { label: string; tone?: "electric" | "graphite" }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={
        tone === "electric"
          ? {
              background:
                "linear-gradient(135deg, oklch(0.68 0.19 255), oklch(0.45 0.2 280))",
              color: "white",
            }
          : { background: "var(--graphite)", color: "var(--foreground)" }
      }
    >
      {label}
    </span>
  );
}

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06] hover:text-foreground">
      {children}
    </button>
  );
}

function DayLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center">
      <span className="rounded-full bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>
    </div>
  );
}

function Bubble({
  from, children, name, media, reactions,
}: {
  from: "me" | "them";
  children: React.ReactNode;
  name?: string;
  media?: boolean;
  reactions?: { e: string; n: number }[];
}) {
  const me = from === "me";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] ${me ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {name && !me && <span className="px-3 text-[10px] font-medium text-muted-foreground">{name}</span>}
        <div
          className={`text-[13.5px] leading-relaxed ${media ? "" : "px-3.5 py-2"} rounded-2xl ${
            me
              ? "bg-electric text-electric-foreground rounded-br-md"
              : "bg-surface-elevated text-foreground rounded-bl-md border border-border/60"
          }`}
        >
          {children}
        </div>
        {reactions && (
          <div className="flex gap-1 pr-1">
            {reactions.map((r) => (
              <span key={r.e} className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px]">
                <span>{r.e}</span>
                <span className="text-muted-foreground">{r.n}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border/60 bg-surface-elevated px-3.5 py-2.5">
        <Dot delay={0} />
        <Dot delay={0.15} />
        <Dot delay={0.3} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80"
      style={{ animation: `float 1.2s ease-in-out ${delay}s infinite` }}
    />
  );
}

/* --------------------------- LOGO STRIP --------------------------- */

function LogoStrip() {
  const items = ["The Verge", "WIRED", "TechCrunch", "Fast Company", "Bloomberg", "The Guardian"];
  return (
    <section aria-label="Featured in" className="border-y border-border/60 bg-surface/40 py-8">
      <div className="mx-auto max-w-6xl px-6">
        <p className="mb-6 text-center text-xs uppercase tracking-widest text-muted-foreground">
          Trusted by teams and covered by
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-70">
          {items.map((n) => (
            <span key={n} className="text-sm font-medium tracking-tight text-muted-foreground/90">
              {n}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- FEATURES ---------------------------- */

function Features() {
  const features = [
    {
      title: "Messages, refined.",
      body: "Threads, reactions, replies, edits, polls, voice notes, code blocks, markdown, scheduling, disappearing messages.",
      accent: "electric",
    },
    {
      title: "Crystal-clear calls.",
      body: "Voice and video for one-to-one or groups. Picture-in-picture, low latency, and adaptive quality on any network.",
    },
    {
      title: "Communities that scale.",
      body: "Channels, roles, announcements, events, and moderation — for a book club or a hundred-thousand-person space.",
    },
    {
      title: "Search that feels instant.",
      body: "Sub-100ms results across messages, media, files, calls and communities. No re-indexing anxiety.",
    },
    {
      title: "Yours on every device.",
      body: "Native Mac, iOS, Android, Windows, Linux and Web. Handoff a message you started on your phone.",
    },
    {
      title: "Made for keyboards.",
      body: "Command palette, jump-to-chat, quick reactions. Move faster without touching a trackpad.",
    },
  ];

  return (
    <section id="features" className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>Product</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
          Everything you want. Nothing you don't.
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Whispr is a complete communication surface, engineered to feel calm even when your life doesn't.
        </p>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard key={f.title} title={f.title} body={f.body} accent={f.accent as never} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ title, body, accent, index }: { title: string; body: string; accent?: "electric"; index: number }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-6 transition-all hover:border-border/80 hover:bg-surface-elevated">
      <div
        aria-hidden
        className={`absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity group-hover:opacity-60 ${accent ? "" : ""}`}
        style={{
          background: accent
            ? "radial-gradient(closest-side, oklch(0.62 0.19 255 / 0.6), transparent)"
            : "radial-gradient(closest-side, oklch(0.5 0.05 260 / 0.4), transparent)",
        }}
      />
      <div className="relative">
        <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-electric">
          <FeatureIcon index={index} />
        </div>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function FeatureIcon({ index }: { index: number }) {
  const props = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons = [
    <svg key="0" {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    <svg key="1" {...props}><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>,
    <svg key="2" {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    <svg key="3" {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
    <svg key="4" {...props}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>,
    <svg key="5" {...props}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg>,
  ];
  return icons[index % icons.length];
}

/* ------------------------ CHAT SHOWCASE ------------------------ */

function ChatShowcase() {
  const slots = [
    { label: "Voice notes", body: "Waveforms you can scrub. Speed up 1x, 1.5x, 2x. Transcripts on tap." },
    { label: "Reactions", body: "One-tap emoji. Long-press for the whole keyboard." },
    { label: "Threads", body: "Follow a side-conversation without losing the main one." },
    { label: "Polls", body: "Anonymous or attributed. Multi-select, deadlines, live results." },
  ];
  return (
    <section className="py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionEyebrow>Messaging</SectionEyebrow>
            <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
              A message is more than text.
            </h2>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">
              Whispr treats conversation like the rich, human thing it is.
              Voice, media, code, polls — expressive without being noisy.
            </p>

            <ul className="mt-8 space-y-4">
              {slots.map((s) => (
                <li key={s.label} className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-electric/15 text-electric">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{s.label}</div>
                    <div className="text-sm text-muted-foreground">{s.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

function PhoneMock() {
  return (
    <div className="relative mx-auto flex justify-center">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-[80px] opacity-50 blur-3xl"
        style={{ background: "radial-gradient(50% 50% at 50% 50%, oklch(0.62 0.19 255 / 0.4), transparent 70%)" }}
      />
      <div className="relative w-[290px] rounded-[46px] border border-border bg-background p-2 shadow-2xl shadow-black/60">
        <div className="rounded-[38px] overflow-hidden border border-border bg-surface">
          <div className="relative flex h-6 items-center justify-center bg-background">
            <div className="h-4 w-24 rounded-full bg-black" />
          </div>
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <span className="text-[10px] text-muted-foreground">9:41</span>
            <span className="text-[10px] text-muted-foreground">●●● 5G</span>
          </div>

          <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
            <Avatar label="MC" tone="electric" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Mira Chen</div>
              <div className="text-[10px] text-muted-foreground">Active now</div>
            </div>
          </div>

          <div className="space-y-3 px-4 py-4">
            <Bubble from="them">Are you free tonight?</Bubble>
            <Bubble from="me">Probably yeah — around 8?</Bubble>
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border/60 bg-surface-elevated px-3 py-2">
                <button className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-electric text-electric-foreground">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div className="flex items-end gap-0.5">
                  {[8,14,20,10,24,16,22,12,18,10,16,8,14,20,12].map((h,i)=>(
                    <span key={i} className="w-0.5 rounded-full bg-electric/70" style={{ height: h }} />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">0:14</span>
              </div>
            </div>
            <Bubble from="me">Perfect. See you then ✨</Bubble>
          </div>

          <div className="mt-2 border-t border-border/60 p-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              Message…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- SECURITY --------------------------- */

function SecuritySection() {
  const points = [
    { t: "Encrypted today, E2EE staged next", b: "TLS 1.3 in transit and encryption at rest ship today. Client-side end-to-end encryption is on a phased, audited rollout — libsignal for 1:1, MLS for groups, SFrame for calls. No silent downgrades." },
    { t: "Your identity, your keys", b: "Per-device keys, safety numbers for out-of-band verification, and passkey / magic-link sign-in on the roadmap. Adding a device never shares private key material." },
    { t: "Minimal metadata, visible to you", b: "We store only what's required to deliver messages. Your privacy dashboard shows the exact fields — live from the database, not a marketing summary." },
    { t: "Open to scrutiny", b: "Public architecture page, security disclosures, a bug-bounty program launching with Phase 1, and independent cryptographic review as a gate on every E2EE claim." },
  ];

  return (
    <section id="security" className="relative py-28">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-electric/40 to-transparent" />
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="lg:sticky lg:top-32">
            <SectionEyebrow>Security</SectionEyebrow>
            <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
              Private by architecture, not by promise.
            </h2>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">
              Whispr is designed so that privacy is a property of the system — verifiable, not aspirational. Read exactly what we protect today and what we don't.
            </p>
            <Link to="/security" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-electric hover:underline">
              Read the security overview
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </Link>
          </div>

          <ul className="space-y-3">
            {points.map((p, i) => (
              <li key={p.t} className="rounded-2xl border border-border bg-surface p-6 transition-colors hover:bg-surface-elevated">
                <div className="flex items-start gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-background font-mono text-xs text-electric">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="font-semibold">{p.t}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{p.b}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}


/* -------------------------- PLATFORMS -------------------------- */

function PlatformsSection() {
  const platforms = ["macOS", "iOS", "Android", "Windows", "Linux", "Web"];
  return (
    <section id="download" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-surface to-background p-10 sm:p-14">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <SectionEyebrow>Everywhere</SectionEyebrow>
              <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
                Native on the platforms you actually use.
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">
                One account. Perfect sync. Handoffs that feel like magic. Whispr respects each platform's conventions instead of fighting them.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {platforms.map((p) => (
                  <span key={p} className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
                    {p}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard k="< 90ms" v="Median message deliver" />
              <StatCard k="99.99%" v="Delivery success" />
              <StatCard k="0" v="Ads. Ever." />
              <StatCard k="Open" v="Security disclosures" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-5">
      <div className="text-2xl font-semibold tracking-tight text-electric">{k}</div>
      <div className="mt-1 text-xs text-muted-foreground">{v}</div>
    </div>
  );
}

/* -------------------------- COMPARISON -------------------------- */

function Comparison() {
  const rows = [
    ["End-to-end encryption architecture", true, true, true],
    ["Native apps on all major platforms", true, false, true],
    ["Communities with roles & moderation", true, false, false],
    ["Message scheduling & disappearing messages", true, true, false],
    ["No ads, ever", true, true, false],
    ["Open security disclosures", true, true, false],
  ] as const;

  return (
    <section id="comparison" className="py-28">

      <div className="mx-auto max-w-5xl px-6">
        <SectionEyebrow>How we compare</SectionEyebrow>
        <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em]">
          The features you want, from a product that respects you.
        </h2>

        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-4 border-b border-border px-5 py-4 text-xs text-muted-foreground">
            <div>Feature</div>
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Logo size={16} /> Whispr
            </div>
            <div>Signal</div>
            <div>Telegram</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-4 px-5 py-4 text-sm ${i % 2 ? "bg-white/[0.02]" : ""}`}>
              <div className="text-foreground/90">{r[0]}</div>
              {[r[1], r[2], r[3]].map((v, j) => (
                <div key={j}>{v ? <Check /> : <Dash />}</div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Comparison reflects publicly available product surfaces at the time of writing. We update it as products evolve.
        </p>
      </div>
    </section>
  );
}

function Check() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-electric/15 text-electric">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </span>
  );
}
function Dash() { return <span className="text-muted-foreground/60">—</span>; }

/* ---------------------------- PRICING ---------------------------- */

function Pricing() {
  const tiers = [
    {
      name: "Personal",
      price: "Free",
      note: "Forever, for everyone.",
      features: ["All messaging features", "Voice & video calls", "Up to 5 devices", "Community membership"],
      cta: "Download Whispr",
      featured: false,
    },
    {
      name: "Pro",
      price: "$6",
      per: "/month",
      note: "For power users.",
      features: ["Everything in Personal", "50GB media storage", "Custom themes & accents", "Priority support"],
      cta: "Start free trial",
      featured: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      note: "For organizations.",
      features: ["SSO / SAML", "Audit logs & retention", "Advanced admin portal", "Dedicated success manager"],
      cta: "Contact sales",
      featured: false,
    },
  ];

  return (
    <section id="pricing" className="py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">Fair, simple, honest.</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Whispr is free for people. Optional Pro pays for the servers.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl border p-6 ${
                t.featured
                  ? "border-electric/60 bg-gradient-to-b from-electric/10 to-surface"
                  : "border-border bg-surface"
              }`}
            >
              {t.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-electric px-2 py-0.5 text-[10px] font-semibold text-electric-foreground">
                  Most popular
                </span>
              )}
              <div className="text-sm font-medium text-muted-foreground">{t.name}</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                {t.per && <span className="text-sm text-muted-foreground">{t.per}</span>}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{t.note}</div>
              <ul className="mt-6 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check /> {f}
                  </li>
                ))}
              </ul>
              {t.cta === "Contact sales" ? (
                <a
                  href="mailto:sales@whispr.app?subject=Whispr%20Enterprise"
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-transform active:scale-[0.98] ${
                    t.featured
                      ? "bg-electric text-electric-foreground hover:brightness-110"
                      : "border border-border bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                  }`}
                >
                  {t.cta}
                </a>
              ) : (
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-transform active:scale-[0.98] ${
                    t.featured
                      ? "bg-electric text-electric-foreground hover:brightness-110"
                      : "border border-border bg-white/[0.03] text-foreground hover:bg-white/[0.06]"
                  }`}
                >
                  {t.cta}
                </Link>
              )}

            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ FAQ ------------------------------ */

function FAQ() {
  const items = [
    { q: "Is Whispr really private?", a: "The messaging architecture is designed so that servers route encrypted payloads and never read message contents. We plan to integrate an established end-to-end encryption protocol rather than invent one." },
    { q: "How do you make money?", a: "Optional Pro subscriptions and Enterprise plans. We don't sell data, run ads, or profile you." },
    { q: "Can I use Whispr for work?", a: "Yes. Enterprise adds SSO, retention controls, audit logs, and an admin portal, while preserving the same product feel." },
    { q: "Do I need a phone number?", a: "No. You can create an account with a username, email, magic link, or passkey. Phone number is optional." },
    { q: "Is there a web version?", a: "Yes. Whispr works in modern browsers with the same interface and near-native performance." },
    { q: "What happens if I lose my device?", a: "Session and device management lets you revoke access remotely. Recovery flows use a verified secondary factor — never a hidden backdoor." },
  ];
  return (
    <section id="faq" className="py-28">
      <div className="mx-auto max-w-4xl px-6">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <h2 className="mt-3 text-balance text-4xl font-semibold tracking-[-0.02em]">Questions, answered.</h2>
        <div className="mt-10 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((it, i) => (
            <FAQItem key={i} {...it} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-white/[0.02]"
        aria-expanded={open}
      >
        <span className="text-[15px] font-medium">{q}</span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border transition-transform ${open ? "rotate-45" : ""}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </span>
      </button>
      <div
        ref={ref}
        className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0">
          <p className="px-6 pb-6 pr-16 text-sm leading-relaxed text-muted-foreground">{a}</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ CTA ------------------------------ */

function CTA() {
  return (
    <section className="pb-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-border p-10 sm:p-16">
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(50% 60% at 50% 0%, oklch(0.62 0.19 255 / 0.4), transparent 70%), var(--surface)",
            }}
          />
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">
              Try Whispr today.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Free forever for individuals. Available on every device you own.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-transform active:scale-[0.98]"
              >
                Create your account
              </Link>
              <a href="#download" className="inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.03] px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06]">
                All platforms
              </a>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- FOOTER ---------------------------- */

function Footer() {
  const cols: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Security", href: "#security" },
        { label: "Download", href: "#download" },
        { label: "Compare", href: "#comparison" },
        { label: "Pricing", href: "#pricing" },
      ],
    },
    {
      title: "Developers",
      links: [
        { label: "Status", href: "#download" },
        { label: "Changelog", href: "#faq" },
        { label: "Bug bounty", href: "mailto:security@whispr.app?subject=Bug%20bounty", external: true },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "#security" },
        { label: "Pricing", href: "#pricing" },
        { label: "Contact", href: "mailto:hello@whispr.app", external: true },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "#security" },
        { label: "Terms", href: "#faq" },
        { label: "Trust center", href: "#security" },
      ],
    },
  ];
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  return (
    <footer className="border-t border-border/60 bg-surface/40 py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <button onClick={scrollTop} className="flex items-center gap-2 text-left">
              <Logo />
              <span className="font-semibold tracking-tight">Whispr</span>
            </button>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              A privacy-first communication platform for messages, calls, and communities.
            </p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.title}</div>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external ? { rel: "noopener noreferrer" } : {})}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border/60 pt-6 sm:flex-row sm:items-center">
          <div className="text-xs text-muted-foreground">© {new Date().getFullYear()} Whispr, Inc. All rights reserved.</div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <button onClick={scrollTop} aria-label="Back to top" className="hover:text-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
            </button>
            <a href="mailto:hello@whispr.app" aria-label="Email us" className="hover:text-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}


function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-electric">
      <span className="h-px w-6 bg-electric/60" />
      {children}
    </span>
  );
}
