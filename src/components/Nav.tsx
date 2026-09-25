"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "대시보드" },
  { href: "/algorithms", label: "알고리즘" },
  { href: "/map-apps", label: "지도앱 비교" },
  { href: "/logs", label: "로그" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-surface">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/" className="font-bold text-base">
          Route Lab
        </Link>
        <ul className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-1.5 rounded-md ${active ? "font-semibold bg-[var(--surface-2)]" : "muted hover:bg-[var(--surface-2)]"}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
