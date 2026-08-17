/**
 * Markets moved to /macro when it grew the rates and curve panels and lost the
 * smart-money table to /sentiment.
 *
 * A redirect rather than a deletion: the carry table and the concentration
 * panel both link out to scorecards, this app has been open in tabs for weeks
 * at a time, and a bookmark that 404s is a worse answer than one that arrives.
 */

import { redirect } from 'next/navigation';

export default function MarketsPage() {
  redirect('/macro');
}
