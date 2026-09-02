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

/** Simple stroked glyphs — no icon dependency for ten shapes. */
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
    href: '/scorecard',
    label: 'Scorecard',
    hint: 'One asset in full',
    icon: <Icon path="M4 3h16v18H4zM8 8h8M8 12h8M8 16h5" />,
  },
  {
    href: '/macro',
    label: 'Macro',
    hint: 'Risk, strength, rates, carry',
    icon: <Icon path="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
  },
  {
    href: '/seasonality',
    label: 'Seasonality',
    hint: 'Month, week and day tendencies',
    icon: <Icon path="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M14 14h2" />,
  },
  {
    href: '/sentiment',
    label: 'Sentiment',
    hint: 'Crowd positioning, contrarian',
    icon: <Icon path="M3 8h18M3 16h18M7 5v6M17 13v6" />,
  },
  {
    href: '/heatmap',
    label: 'Heatmap',
    hint: 'Economic data by currency',
    icon: <Icon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  },
  {
    href: '/surprise',
    label: 'Surprise Meter',
    hint: 'Who is beating expectations',
    // A dial: a semicircle with a needle.
    icon: <Icon path="M3 15a9 9 0 0118 0M12 15l4-5" />,
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
  {
    href: '/chart',
    label: 'Chart',
    hint: 'Structure, levels, setup plan',
    icon: <Icon path="M3 21h18M7 17V9m5 8V5m5 12v-6M4 12l4-4 4 3 5-6" />,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  /**
   * Exact match or a real sub-path, NOT a bare `startsWith`: with the loose test
   * `/charts` also matched `/chart` and lit both tabs at once.
   *
   * `/scorecard` now owns its own subtree, where it used to be folded under Top
   * Setups. Keeping the old rule alongside a real Scorecard tab would have lit
   * both at once on every `/scorecard/EURUSD`. `/history/[symbol]` still has no
   * tab of its own and stays under Scorecard, which is where it is linked from.
   */
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/scorecard') {
      return pathname.startsWith('/scorecard') || pathname.startsWith('/history');
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      /*
        Below `lg` this is a horizontal bar. Ten items do not fit on a phone, and
        the previous flex row shrank every label to an unreadable stub rather
        than overflowing. `overflow-x-auto` plus `shrink-0` on the links makes it
        scroll instead — each tab keeps its full width and the row slides.
      */
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2 lg:h-screen lg:w-52 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-3"
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
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors lg:shrink ${
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
