'use client';

/**
 * The /ai screen: the chat fills the viewport, and the context the analyst
 * reads sits in a side column on the right, the way a chat app lays out a
 * conversation beside its sources.
 *
 * The side column is one element that changes role with the screen. From xl up
 * it is a column beside the chat, open by default and closable (remembered per
 * browser). Below xl there is no room for both, so it becomes a drawer that
 * slides over the chat and starts closed. It is rendered once either way:
 * rendering it twice would build every server section in it twice.
 *
 * The toggle lives in the chat's own top bar, so it is handed down through
 * context rather than drawn here.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'ai-analysis:side';
/** Tailwind's xl, where the side column stops being a drawer. */
const WIDE = '(min-width: 1280px)';

interface SidePanel {
  /** Whether the column is showing at the current width. */
  open: boolean;
  toggle: () => void;
}

const SideContext = createContext<SidePanel | null>(null);

/** The side column's state, or null outside the /ai workspace. */
export function useSidePanel(): SidePanel | null {
  return useContext(SideContext);
}

export function AiWorkspace({ side, children }: { side: ReactNode; children: ReactNode }) {
  const [wideOpen, setWideOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener('change', sync);
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
      if (window.localStorage.getItem(STORAGE_KEY) === 'closed') setWideOpen(false);
    } catch {
      // storage blocked: the column just starts open
    }
    return () => media.removeEventListener('change', sync);
  }, []);

  // Escape closes the drawer, as it does the main navigation's.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggle = useCallback(() => {
    if (!window.matchMedia(WIDE).matches) {
      setDrawerOpen((o) => !o);
      return;
    }
    setWideOpen((o) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, o ? 'closed' : 'open');
      } catch {
        // not remembered, still toggled
      }
      return !o;
    });
  }, []);

  const open = wide ? wideOpen : drawerOpen;

  return (
    <SideContext.Provider value={{ open, toggle }}>
      {/* Fixed rather than full-height in flow: the root layout pads its column
          for the phone tab bar, which this page does not have. */}
      <div className="fixed inset-0 flex overflow-hidden bg-[var(--color-bg)]">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>

        {drawerOpen && (
          <button
            type="button"
            aria-label="Close the context panel"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-black/55 xl:hidden"
            style={{ zIndex: 'var(--z-drawer)' }}
          />
        )}

        <aside
          aria-label="What the analyst reads"
          className={`fixed inset-y-0 right-0 flex w-[min(26rem,92vw)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] transition-transform duration-200 xl:static xl:w-[26rem] xl:translate-x-0 xl:bg-[var(--color-surface)]/45 xl:transition-none ${
            drawerOpen ? 'translate-x-0' : 'translate-x-full'
          } ${wideOpen ? 'xl:flex' : 'xl:hidden'}`}
          style={{ zIndex: 'var(--z-drawer)' }}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text)]">Context</p>
              <p className="truncate text-micro text-[var(--color-faint)]">What the analyst reads before it answers</p>
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label="Close the context panel"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto overscroll-contain">{side}</div>
        </aside>
      </div>
    </SideContext.Provider>
  );
}
