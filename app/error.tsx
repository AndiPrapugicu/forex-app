'use client'; // Error boundaries must be Client Components

/**
 * Fallback for a route that throws.
 *
 * Almost every failure here is an upstream feed timing out, which is exactly
 * the case `retry` exists for: it re-fetches and re-renders the segment rather
 * than just clearing local state (`reset`). `retry` is stable as of Next 16.3,
 * which this app runs — see node_modules/next/dist/docs/.../error.md.
 */

import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bear)]/15 text-[var(--color-bear)]">
        <span aria-hidden className="text-title font-bold">!</span>
      </div>
      <h1 className="text-title font-semibold">This page could not load</h1>
      <p className="text-body text-[var(--color-muted)]">
        One of the data feeds behind it failed or timed out. They usually recover within a minute.
      </p>
      {error.digest && (
        <p className="text-micro text-[var(--color-faint)]">
          Reference <code className="tnum">{error.digest}</code>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="min-h-11 rounded-[var(--radius-control)] bg-[var(--color-bull-cell)] px-5 text-body font-semibold text-white hover:brightness-110"
        >
          Try again
        </button>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--color-border-bright)] px-5 text-body text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          Back to Top Setups
        </Link>
      </div>
    </div>
  );
}
