'use client';

/**
 * Navigation, grouped the way EdgeFinder's own sidebar is.
 *
 * Desktop (lg+): a fixed column of collapsible sections — Board, COT, Crowd
 * Sentiment, Macro Scanners, Economic Heatmaps, Economic Data, Scanners, Tools.
 * The section holding the current page opens itself.
 *
 * Mobile: a slim top bar with a menu button that opens the full tree as a
 * drawer, plus a bottom tab bar for the four places people actually go. The old
 * horizontally-scrolling strip hid most of its eleven items with no sign that
 * it scrolled at all.
 *
 * ONLY ROUTES THAT EXIST ARE LINKED. A section with nothing real in it is not
 * rendered, rather than filled with links to pages that 404.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: string;
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

/** Stroked glyph paths — no icon dependency for a dozen shapes. */
const ICON = {
  board: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  card: 'M4 3h16v18H4zM8 8h8M8 12h8M8 16h5',
  cot: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  crowd: 'M3 8h18M3 16h18M7 5v6M17 13v6',
  macro: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
  dial: 'M3 15a9 9 0 0118 0M12 15l4-5',
  heat: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  data: 'M3 3v18h18M6 16l4-6 4 3 5-8',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M14 14h2',
  chart: 'M3 21h18M7 17V9m5 8V5m5 12v-6M4 12l4-4 4 3 5-6',
  news: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
} as const;

const GROUPS: NavGroup[] = [
  {
    key: 'board',
    label: 'Board',
    items: [
      { href: '/', label: 'Top Setups', hint: 'Every symbol, every indicator', icon: ICON.board },
      { href: '/scorecard', label: 'Scorecard', hint: 'One asset in full', icon: ICON.card },
    ],
  },
  {
    key: 'cot',
    label: 'COT',
    items: [
      { href: '/cot', label: 'Latest COT Report', hint: 'Institutional positioning', icon: ICON.cot },
      { href: '/cot/history', label: 'COT History', hint: 'Three years, one contract', icon: ICON.data },
      { href: '/cot/velocity', label: 'COT Velocity', hint: 'This week against its own history', icon: ICON.dial },
      { href: '/cot/trends', label: 'COT Trends', hint: 'Net change over 1 to 26 weeks', icon: ICON.chart },
    ],
  },
  {
    key: 'crowd',
    label: 'Crowd Sentiment',
    items: [
      { href: '/sentiment', label: 'Retail Sentiment', hint: 'Crowd positioning, contrarian', icon: ICON.crowd },
      { href: '/sentiment/smart-money', label: 'Smart Money', hint: 'Institutions against the crowd', icon: ICON.cot },
      { href: '/options/put-call', label: 'Put-Call Ratio', hint: '5-day average, A1 bands', icon: ICON.chart },
      { href: '/options/volume', label: 'Net Options Volume', hint: 'Calls minus puts traded', icon: ICON.dial },
      { href: '/options/walls', label: 'Put & Call Walls', hint: 'Open interest by strike', icon: ICON.data },
    ],
  },
  {
    key: 'macro',
    label: 'Macro Scanners',
    items: [
      { href: '/macro', label: 'Overview', hint: 'Every scanner at a glance', icon: ICON.macro },
      { href: '/surprise', label: 'Eco Surprise', hint: 'Who is beating expectations', icon: ICON.dial },
      { href: '/scanners/eco-strength', label: 'Eco Strength', hint: 'Where each economy stands', icon: ICON.data },
      { href: '/scanners/real-yield', label: 'Real Yield', hint: 'Policy rate minus inflation', icon: ICON.chart },
      { href: '/scanners/carry', label: 'Carry', hint: 'Rate differential per pair', icon: ICON.heat },
      { href: '/scanners/risk', label: 'Risk & Concentration', hint: 'Risk appetite, stacked trades', icon: ICON.board },
    ],
  },
  {
    key: 'heatmaps',
    label: 'Economic Heatmaps',
    items: [{ href: '/heatmap', label: 'Heatmap', hint: 'Economic data by currency', icon: ICON.heat }],
  },
  {
    key: 'data',
    label: 'Economic Data',
    items: [
      { href: '/charts', label: 'By Economy', hint: 'Every indicator for one currency', icon: ICON.data },
      { href: '/data/gdp', label: 'GDP', hint: 'Growth, all eight economies', icon: ICON.data },
      { href: '/data/mpmi', label: 'Manufacturing PMI', hint: 'Above 50 is expansion', icon: ICON.data },
      { href: '/data/spmi', label: 'Services PMI', hint: 'Above 50 is expansion', icon: ICON.data },
      { href: '/data/retail-sales', label: 'Retail Sales', hint: 'Consumer spending', icon: ICON.data },
      { href: '/data/consumer-confidence', label: 'Consumer Confidence', hint: 'Household sentiment', icon: ICON.data },
      { href: '/data/cpi', label: 'Inflation (CPI)', hint: 'Headline consumer prices', icon: ICON.data },
      { href: '/data/ppi', label: 'Producer Prices', hint: 'Pipeline inflation', icon: ICON.data },
      { href: '/data/employment', label: 'Employment', hint: 'Jobs added', icon: ICON.data },
      { href: '/data/unemployment', label: 'Unemployment', hint: 'Lower is stronger', icon: ICON.data },
    ],
  },
  {
    key: 'scanners',
    label: 'Scanners',
    items: [
      { href: '/seasonality', label: 'Seasonality', hint: 'Month, week and day tendencies', icon: ICON.calendar },
      { href: '/scanners/momentum', label: 'Momentum & Volatility', hint: 'Moving averages and daily range', icon: ICON.chart },
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    items: [
      { href: '/calendar', label: 'Economic Calendar', hint: 'Upcoming releases and surprises', icon: ICON.calendar },
      { href: '/news', label: 'News & Alerts', hint: 'Alerts, headlines, market mood', icon: ICON.news },
    ],
  },
];

/** The four bottom-bar destinations on a phone. Everything else is one tap away in the drawer. */
const TABS: NavItem[] = [
  GROUPS[0].items[0],
  GROUPS[0].items[1],
  GROUPS[1].items[0],
  GROUPS[3].items[0],
];

function Icon({ path, className = 'h-[18px] w-[18px]' }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Exact match or a real sub-path, NOT a bare `startsWith`: with the loose test
 * `/charts` also matched `/chart` and lit both at once. `/history/[symbol]` has
 * no entry of its own and stays under Scorecard, which is where it is linked from.
 */
const ALL_HREFS = GROUPS.flatMap((g) => g.items.map((i) => i.href));

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/scorecard') return pathname.startsWith('/scorecard') || pathname.startsWith('/history');
  if (!matches(pathname, href)) return false;
  // `/cot` must not light up on `/cot/history`, which has its own entry: the
  // most specific link wins.
  return !ALL_HREFS.some((other) => other.length > href.length && matches(pathname, other));
}

function Brand() {
  return (
    <span className="text-body font-bold tracking-wide">
      FX<span className="text-[var(--color-bull)]">INTEL</span>
    </span>
  );
}

function NavTree({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const activeGroup = GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)))?.key;
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.key, true])),
  );

  // Navigating into a collapsed section opens it, so the current page is never hidden.
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o[activeGroup] ? o : { ...o, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <div className="flex flex-col gap-1">
      {GROUPS.map((group) => {
        const expanded = open[group.key];
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [group.key]: !o[group.key] }))}
              aria-expanded={expanded}
              className="flex min-h-9 w-full items-center justify-between rounded-[var(--radius-control)] px-3 text-micro font-semibold tracking-wider text-[var(--color-faint)] uppercase hover:text-[var(--color-muted)]"
            >
              {group.label}
              <Icon
                path={ICON.chevron}
                className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
            {expanded && (
              <ul className="mb-2 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 transition-colors ${
                          active
                            ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] shadow-[inset_2px_0_0_var(--color-bull)]'
                            : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                        }`}
                      >
                        <span className={active ? 'text-[var(--color-bull)]' : ''}>
                          <Icon path={item.icon} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-body font-medium">{item.label}</span>
                          <span className="truncate text-micro text-[var(--color-faint)]">{item.hint}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on navigation, and on Escape.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <>
      {/* ---------- Desktop column ---------- */}
      <nav
        aria-label="Main"
        className="hidden shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-col lg:overflow-y-auto lg:p-3"
      >
        <div className="px-3 pt-2 pb-4">
          <Brand />
        </div>
        <NavTree pathname={pathname} />
        <p className="mt-auto px-3 pt-4 pb-2 text-micro leading-relaxed text-[var(--color-faint)]">
          Scores are rule-based and reproducible from <code>config/</code>. Not financial advice.
        </p>
      </nav>

      {/* ---------- Mobile top bar ---------- */}
      <header
        className="sticky top-0 flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-2 backdrop-blur lg:hidden"
        style={{ zIndex: 'var(--z-header)' }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
        >
          <Icon path={ICON.menu} className="h-5 w-5" />
        </button>
        <Brand />
        {/* Balances the menu button so the brand sits centred. */}
        <span className="h-11 w-11" aria-hidden />
      </header>

      {/* ---------- Mobile drawer ---------- */}
      {drawerOpen && (
        <div className="fixed inset-0 lg:hidden" style={{ zIndex: 'var(--z-drawer)' }}>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <nav
            aria-label="Main"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center justify-between px-1 pb-3">
              <span className="px-2">
                <Brand />
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                <Icon path={ICON.close} className="h-5 w-5" />
              </button>
            </div>
            <NavTree pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </div>
      )}

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        style={{ zIndex: 'var(--z-tabbar)' }}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-micro ${
                active ? 'text-[var(--color-bull)]' : 'text-[var(--color-muted)]'
              }`}
            >
              <Icon path={tab.icon} className="h-5 w-5" />
              <span className="max-w-full truncate px-1">{tab.label.replace('Latest ', '').replace(' Report', '')}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="More pages"
          className="flex h-16 flex-col items-center justify-center gap-1 text-micro text-[var(--color-muted)]"
        >
          <Icon path={ICON.menu} className="h-5 w-5" />
          More
        </button>
      </nav>
    </>
  );
}
