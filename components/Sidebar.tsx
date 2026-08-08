'use client';

/**
 * Left navigation.
 *
 * Collapses to a top bar under `lg`, because the setups matrix is the widest
 * thing in the app and a fixed sidebar would squeeze it on a laptop screen.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

/** Simple stroked glyphs — no icon dependency for eight shapes. */
function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Top Setups',
    hint: 'Every symbol, every indicator',
    icon: <Icon path="M3 3v18h18M7 15l4-4 3 3 5-6" />,
  },
  {
    href: '/heatmap',
    label: 'Heatmap',
    hint: 'Economic data by currency',
    icon: <Icon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  },
  {
    href: '/cot',
    label: 'COT',
    hint: 'Institutional positioning',
    icon: <Icon path="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    href: '/charts',
    label: 'Indicators',
    hint: 'History vs forecast',
    icon: <Icon path="M3 3v18h18M6 16l4-6 4 3 5-8" />,
  },
  {
    href: '/news',
    label: 'News & Alerts',
    hint: 'Market mood, calendar, alerts',
    icon: <Icon path="M4 5h16M4 10h16M4 15h10M4 20h7" />,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  // A scorecard page is reached from Top Setups, so it keeps that tab lit.
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/scorecard') : pathname.startsWith(href);

  return (
    <nav
      className="flex shrink-0 gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2 lg:h-screen lg:w-52 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-3"
      aria-label="Main"
    >
      <div className="mb-0 hidden px-2 py-3 lg:block">
        <span className="text-sm font-bold tracking-wide">
          FX<span className="text-[var(--color-bull)]">INTEL</span>
        </span>
      </div>

      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-text)]'
            }`}
          >
            <span className={active ? 'text-[var(--color-bull)]' : ''}>{item.icon}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.label}</span>
              <span className="hidden truncate text-[10px] text-[var(--color-faint)] lg:block">
                {item.hint}
              </span>
            </span>
          </Link>
        );
      })}

      <div className="mt-auto hidden px-3 pt-4 pb-14 lg:block">
        <p className="text-[10px] leading-relaxed text-[var(--color-faint)]">
          Scores are rule-based and reproducible from <code>config/</code>. Not financial advice.
        </p>
      </div>
    </nav>
  );
}
