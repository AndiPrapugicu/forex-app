/**
 * Markets moved to /macro, which is now the index of the /scanners/* routes.
 * Institutional-versus-retail positioning lives at /sentiment/smart-money.
 *
 * A redirect rather than a deletion: the carry table and the concentration
 * panel both link out to scorecards, this app has been open in tabs for weeks
 * at a time, and a bookmark that 404s is a worse answer than one that arrives.
 */

import { redirect } from 'next/navigation';

export default function MarketsPage() {
  redirect('/macro');
}
