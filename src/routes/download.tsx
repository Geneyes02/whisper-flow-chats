import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/download")({
  component: DownloadPage,
  head: () => ({
    meta: [
      { title: "Download Whispr — Mac, Windows, iOS, Android" },
      {
        name: "description",
        content:
          "Install Whispr on your Mac, install as a web app on Windows, or add to your phone's home screen.",
      },
      { property: "og:title", content: "Download Whispr" },
      {
        property: "og:description",
        content: "Signed Mac app, web-installable on Windows and mobile.",
      },
    ],
  }),
});

type Platform = "mac" | "windows" | "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "other";
}

// Latest signed macOS release. Replace with your GitHub release asset URL after
// the first tagged build completes (or leave pointing at /latest/download for
// auto-latest).
const MAC_DMG_URL =
  "https://github.com/OWNER/REPO/releases/latest/download/Whispr.dmg";

function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>("other");
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function installWebApp() {
    if (!installEvent) return;
    // Non-standard prompt() on BeforeInstallPromptEvent.
    await (installEvent as unknown as { prompt: () => Promise<void> }).prompt();
    setInstallEvent(null);
  }

  const primary =
    platform === "mac"
      ? {
          label: "Download for Mac",
          sub: "Signed & notarized · Universal (Apple Silicon + Intel)",
          action: (
            <a
              href={MAC_DMG_URL}
              className="inline-flex items-center gap-2 rounded-full bg-electric px-6 py-3 text-sm font-medium text-electric-foreground shadow-lg shadow-electric/30 transition-transform hover:brightness-110 active:scale-[0.98]"
            >
              <MacIcon /> Download for Mac
            </a>
          ),
        }
      : {
          label: "Install Whispr",
          sub: installed
            ? "Installed. Look for Whispr in your apps."
            : installEvent
            ? "Install as a desktop app — no App Store, no warnings."
            : "Open in Chrome or Edge, then choose Install from the menu.",
          action: (
            <button
              disabled={!installEvent || installed}
              onClick={installWebApp}
              className="inline-flex items-center gap-2 rounded-full bg-electric px-6 py-3 text-sm font-medium text-electric-foreground shadow-lg shadow-electric/30 transition-transform hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <DownloadIcon /> {installed ? "Installed" : "Install Whispr"}
            </button>
          ),
        };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--electric) 22%, transparent), transparent)",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md avatar-gradient text-[11px]">W</span>
          Whispr
        </Link>
        <Link
          to="/auth"
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
        >
          Sign in
        </Link>
      </header>

      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-14 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Download</p>
        <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight md:text-6xl">
          Whispr, on every device
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground">
          {primary.sub}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {primary.action}
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06]"
          >
            Open in browser
          </Link>
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl gap-4 md:grid-cols-3">
          <Card
            icon={<MacIcon />}
            title="Mac"
            body="Signed & notarized .dmg. Opens with zero warnings on macOS 12+."
            cta={
              <a href={MAC_DMG_URL} className="text-xs text-electric hover:brightness-110">
                Download .dmg →
              </a>
            }
          />
          <Card
            icon={<WindowsIcon />}
            title="Windows"
            body="Install from Edge or Chrome — a real app window, own icon, no SmartScreen prompt."
            cta={
              <button
                disabled={!installEvent || installed}
                onClick={installWebApp}
                className="text-xs text-electric hover:brightness-110 disabled:opacity-40"
              >
                {installed ? "Installed" : installEvent ? "Install now →" : "Use browser menu →"}
              </button>
            }
          />
          <Card
            icon={<PhoneIcon />}
            title="iOS & Android"
            body="Open Whispr in Safari or Chrome and choose Add to Home Screen."
            cta={<span className="text-xs text-muted-foreground">Coming to App Store &amp; Play</span>}
          />
        </div>

        <p className="mx-auto mt-12 max-w-md text-xs text-muted-foreground/70">
          Whispr is currently in preview. Encrypted in transit and at rest — end-to-end
          encryption ships after independent audit.
        </p>
      </section>
    </main>
  );
}

function Card({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left backdrop-blur-xl">
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] text-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-3">{cta}</div>
    </div>
  );
}

function MacIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.22-1.28 3.03-.86.85-2.19 1.5-3.24 1.42-.14-1.1.4-2.24 1.22-3.03.9-.88 2.36-1.53 3.3-1.42zM20.5 17.4c-.55 1.24-.8 1.8-1.5 2.9-.98 1.55-2.36 3.48-4.07 3.5-1.52 0-1.91-.99-3.98-.98-2.07.01-2.5.99-4.03.98-1.71-.02-3.02-1.75-4-3.3C.53 16.53-.15 12.4 1.87 9.72c1.36-1.8 3.5-2.86 5.52-2.86 2.05 0 3.34 1.12 5.03 1.12 1.65 0 2.65-1.12 5.02-1.12 1.8 0 3.7.98 5.05 2.67-4.44 2.43-3.72 8.78-1.99 7.87z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2 4.5 11 3.2v8.3H2zM11 12.5v8.3L2 19.5v-7zM12 3.05 22 1.7v9.8H12zM22 12.5v9.8l-10-1.35V12.5z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}
