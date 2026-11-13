import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RelayDesk",
  description: "Operator console for RelayDesk",
};

const navigation = [
  { href: "/", label: "Dashboard" },
  { href: "/nodes", label: "Nodes" },
  { href: "/tasks", label: "Tasks" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-xl">
            <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
              <Link href="/" className="flex items-center gap-3" aria-label="RelayDesk home">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent shadow-glow">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white" aria-hidden="true">
                    <path d="M5 8.5 12 4l7 4.5v7L12 20l-7-4.5v-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                    <path d="m8.5 10 3.5 2.2 3.5-2.2M12 12.2V17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-[15px] font-semibold tracking-tight text-white">Relay<span className="text-accent">Desk</span></span>
              </Link>
              <nav aria-label="Main navigation" className="flex items-center gap-1">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white sm:px-4"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-slate-400 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Operator
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10">{children}</main>
          <footer className="mx-auto flex max-w-[1440px] items-center justify-between border-t border-line px-5 py-5 text-xs text-muted sm:px-8">
            <span>RelayDesk Operator Console</span>
            <span>v1.0</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
