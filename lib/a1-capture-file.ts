/**
 * Loads the most recent captured A1 board off disk, for the mirror toggle.
 *
 * SERVER ONLY — it reads `fixtures/`. The mirror overlay is built during the
 * request and shipped as a compact diff, so nothing here reaches the browser.
 *
 * A CAPTURE IS DATED AND THE UI SAYS SO. These fixtures are transcriptions of
 * A1's board on one morning, not a feed; the newest one is chosen by the date
 * in its filename rather than by mtime, because a file re-saved by an editor
 * must not become "the latest board". Callers render `label` beside anything
 * built from it so a two-week-old capture cannot be mistaken for today's.
 *
 * Returns `null` rather than throwing when the directory is missing or holds no
 * capture. A board with no mirror available is a normal state — every `captured`
 * tier degrades to ours and says so — and it must never take the page down.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseCapture, type A1Capture } from '@/lib/scoring/a1-pair-legs';

/**
 * `a1-top-setups-2026-09-01.csv`, or `a1-top-setups-2026-09-01-1433.csv` for a
 * second capture the same day.
 *
 * THE TIME SUFFIX IS NOT COSMETIC. Their board moved 31 of 54 rows between
 * 09:44 and 14:33 UTC on 2026-09-01 — seasonality rolled from August to
 * September (20 cells) and trend recomputed (14) — while not one macro cell
 * changed. A capture is a fact about a MOMENT, not about a day, and two
 * captures from one day that overwrite each other would have destroyed the
 * observation that settled the month-turn question.
 */
const CAPTURE_PATTERN = /^a1-top-setups-(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?\.csv$/;

/**
 * Filename -> the moment it claims, newest first.
 *
 * A capture with no time suffix sorts BEFORE any timed capture from the same
 * day. That is deliberate rather than arbitrary: the untimed files predate the
 * convention and were all taken in the morning, so treating them as 00:00 keeps
 * the ordering honest for the only day where both forms exist.
 */
export function listCaptures(dir = path.join(process.cwd(), 'fixtures')): { file: string; date: string; time: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((file) => {
      const m = CAPTURE_PATTERN.exec(file);
      return m ? { file, date: m[1], time: m[2] ?? '0000' } : null;
    })
    .filter((c): c is { file: string; date: string; time: string } => c !== null)
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
}

/**
 * The mirror stops reading a capture older than this.
 *
 * Measured 2026-09-15: the mirror was still outlining cells read from the
 * 2026-09-02 board, thirteen days and several releases later, so the toggle had
 * become a viewer for a stale fixture — exactly what its header promised it
 * would not be. Parity scripts keep `loadLatestA1Capture`, which is unaffected:
 * they rewind to the capture's own moment, so its age is irrelevant there.
 */
export const MIRROR_CAPTURE_MAX_AGE_DAYS = 7;

/** A capture's claimed moment from its filename parts; untimed means 00:00 UTC. */
export function captureMoment(date: string, time: string): Date {
  return new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`);
}

export function isCaptureFresh(date: string, time: string, now: Date, maxAgeDays = MIRROR_CAPTURE_MAX_AGE_DAYS): boolean {
  const ageMs = now.getTime() - captureMoment(date, time).getTime();
  return ageMs <= maxAgeDays * 86_400_000;
}

let cached: { file: string; capture: A1Capture } | null = null;

/**
 * The newest capture, parsed. Memoised per process: the fixture set only
 * changes when someone commits a new one, and re-parsing 54 rows on every
 * request to render a toggle nobody has clicked is waste.
 */
export function loadLatestA1Capture(): A1Capture | null {
  const newest = listCaptures()[0];
  if (!newest) return null;
  if (cached?.file === newest.file) return cached.capture;

  try {
    const text = fs.readFileSync(path.join(process.cwd(), 'fixtures', newest.file), 'utf8');
    const label = newest.time === '0000'
      ? newest.date
      : `${newest.date} ${newest.time.slice(0, 2)}:${newest.time.slice(2)}`;
    const capture = parseCapture(text, label);
    cached = { file: newest.file, capture };
    return capture;
  } catch {
    return null;
  }
}

/**
 * The capture the mirror may read, or none if the newest one is too old.
 *
 * `staleLabel` names the capture that was refused, so the UI can say why no
 * cell is being read from A1's board rather than silently showing ours.
 */
export function loadMirrorCapture(now = new Date()): { capture: A1Capture | null; staleLabel: string | null } {
  const newest = listCaptures()[0];
  if (!newest) return { capture: null, staleLabel: null };
  if (!isCaptureFresh(newest.date, newest.time, now)) {
    const label = newest.time === '0000' ? newest.date : `${newest.date} ${newest.time.slice(0, 2)}:${newest.time.slice(2)}`;
    return { capture: null, staleLabel: label };
  }
  return { capture: loadLatestA1Capture(), staleLabel: null };
}
