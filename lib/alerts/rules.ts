/**
 * Alert rules.
 *
 * Alerts are the one part of the app that interrupts the user, so the bar is
 * high: every alert must be actionable, carry its sources, and never assert a
 * single unverified headline as fact. Anything that fails those tests either
 * gets downgraded in severity or is not raised at all.
 */

import { CONFIDENCE_FLOOR, CORROBORATION_DOMAINS } from '@/config/scoring.config';
import { stableId } from '@/lib/connectors/base';
import { clusterSeverity, isCorroborated } from '@/lib/scoring/news';
import type {
  Alert,
  AlertSeverity,
  Currency,
  EventScore,
  NewsCluster,
  NormalizedEvent,
} from '@/lib/types';

/** How far ahead a high-impact release triggers a heads-up. */
const UPCOMING_WINDOW_MINUTES = 30;

/** Sigma beyond which a print counts as a genuine surprise worth interrupting for. */
const SURPRISE_SIGMA_THRESHOLD = 1.5;

/** How many scored events on one currency in the window count as a cluster. */
const CURRENCY_CLUSTER_MIN = 3;
const CURRENCY_CLUSTER_WINDOW_HOURS = 6;

function severityFromScore(absScore: number, confidence: number): AlertSeverity {
  if (confidence < CONFIDENCE_FLOOR) return 'info';
  if (absScore >= 7) return 'critical';
  if (absScore >= 4) return 'high';
  if (absScore >= 2) return 'medium';
  return 'info';
}

function fmt(value: number | null): string {
  if (value === null) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * A high-impact release is imminent.
 *
 * Deliberately hash-stable per event (no timestamp): the cron runs every 10
 * minutes over an overlapping window, so a time-varying hash would re-alert on
 * every single pass.
 */
export function upcomingEventAlerts(events: NormalizedEvent[], now: Date): Alert[] {
  const windowEnd = now.getTime() + UPCOMING_WINDOW_MINUTES * 60_000;

  return events
    .filter((e) => {
      if (e.impact !== 'HIGH') return false;
      const t = new Date(e.dateUtc).getTime();
      return t > now.getTime() && t <= windowEnd;
    })
    .map((e) => {
      const minutes = Math.round((new Date(e.dateUtc).getTime() - now.getTime()) / 60_000);
      return {
        id: stableId('alert', 'upcoming', e.id),
        hash: stableId('alert', 'upcoming', e.id),
        kind: 'high-impact-upcoming' as const,
        severity: 'medium' as AlertSeverity,
        title: `${e.currency} ${e.name} in ${minutes}m`,
        body:
          `High-impact ${e.currency} release at ${new Date(e.dateUtc).toISOString().slice(11, 16)} UTC. ` +
          `Forecast ${fmt(e.consensus)}, previous ${fmt(e.previous)}.`,
        affects: [e.currency] as Currency[],
        sources: e.sourceUrl ? [{ name: e.source, url: e.sourceUrl }] : [],
        /*
         * When it ENTERED the heads-up window, not when this run happened. The
         * dashboard re-evaluates every poll; stamping `now` made every alert
         * read "now" forever.
         */
        createdUtc: new Date(new Date(e.dateUtc).getTime() - UPCOMING_WINDOW_MINUTES * 60_000).toISOString(),
        highConfidence: true, // a scheduled release is a fact, not a claim
        eventId: e.id,
      };
    });
}

/**
 * A release came in far from forecast.
 *
 * The hash includes the actual value so a revision legitimately re-alerts, but
 * a repeated ingest of the same number does not.
 */
export function surpriseAlerts(
  scored: { event: NormalizedEvent; score: EventScore }[],
  now: Date,
): Alert[] {
  // flatMap rather than filter+map: a filter's guarantees do not narrow types in
  // the following map, and `surprise` is genuinely nullable on the type.
  return scored.flatMap(({ event, score }) => {
    const surprise = score.surprise;
    if (event.actual === null || surprise === null) return [];

    /**
     * A surprise is defined RELATIVE TO EXPECTATIONS, so no forecast means no
     * surprise to alert on.
     *
     * The scoring engine still scores these off `previous` (damped, and with a
     * confidence penalty) because a directional read is better than nothing on
     * the dashboard. But an alert is an interruption, and "54.1 vs n/a forecast,
     * -1.5σ" is a meaningless thing to push to someone's phone — the sigma there
     * measures movement from last month, not a market miss.
     */
    if (event.consensus === null) return [];

    if (Math.abs(surprise) < SURPRISE_SIGMA_THRESHOLD) return [];
    // Low-impact noise is not worth a phone buzz however far off forecast.
    if (event.impact !== 'HIGH' && event.impact !== 'MEDIUM') return [];

    {
      const dir = score.score > 0 ? 'bullish' : 'bearish';
      const verdict =
        score.direction === 'uncertain'
          ? `Direction uncertain (confidence ${score.confidence})`
          : `${dir} ${event.currency} — score ${score.score > 0 ? '+' : ''}${score.score}`;

      return [
        {
          id: stableId('alert', 'surprise', event.id, event.actual),
          hash: stableId('alert', 'surprise', event.id, event.actual),
          kind: 'surprise-deviation' as const,
          severity: severityFromScore(Math.abs(score.score), score.confidence),
          title: `${event.currency} ${event.name}: ${fmt(event.actual)} vs ${fmt(event.consensus)} forecast`,
          body:
            `${surprise > 0 ? '+' : ''}${surprise}σ surprise. ${verdict}. ` +
            `Previous ${fmt(event.previous)}.` +
            (score.polarityConflict ? ' Note: source disagrees with our polarity rule.' : ''),
          affects: [event.currency] as Currency[],
          sources: event.sourceUrl ? [{ name: event.source, url: event.sourceUrl }] : [],
          // The release time: the surprise happened then, not at this poll.
          createdUtc: new Date(event.dateUtc).toISOString(),
          highConfidence: score.confidence >= CONFIDENCE_FLOOR,
          eventId: event.id,
        },
      ];
    }
  });
}

/**
 * Breaking geopolitical / risk news.
 *
 * Severity is capped for uncorroborated stories no matter how alarming the
 * wording, and the body says plainly that it is a single unverified report.
 * That is the difference between an alert and a rumour mill.
 */
export function newsAlerts(clusters: NewsCluster[], now: Date): Alert[] {
  const alerts: Alert[] = [];

  for (const cluster of clusters) {
    const severity = clusterSeverity(cluster);
    if (severity < 0.6) continue;

    // Only alert on genuinely fresh stories.
    const ageHours = (now.getTime() - new Date(cluster.lastSeenUtc).getTime()) / 3_600_000;
    if (ageHours > 6) continue;

    const corroborated = isCorroborated(cluster);

    // An uncorroborated single report can reach 'medium' at most, however
    // severe the language — one outlet is not evidence.
    const level: AlertSeverity = !corroborated
      ? 'medium'
      : severity >= 0.9
        ? 'critical'
        : severity >= 0.7
          ? 'high'
          : 'medium';

    const sources = cluster.items
      .slice(0, 5)
      .map((i) => ({ name: i.sourceName, url: i.url }));

    alerts.push({
      id: stableId('alert', 'news', cluster.id),
      hash: stableId('alert', 'news', cluster.id),
      kind: cluster.category === 'central-bank' ? 'central-bank' : 'geopolitical',
      severity: level,
      title: cluster.headline,
      body: corroborated
        ? `Reported by ${cluster.domainCount} independent sources: ${cluster.items
            .map((i) => i.sourceName)
            .filter((v, idx, arr) => arr.indexOf(v) === idx)
            .slice(0, 4)
            .join(', ')}.`
        : `SINGLE UNVERIFIED SOURCE (${cluster.items[0].sourceName}). Not corroborated by other outlets — treat with caution.`,
      affects: [...new Set(cluster.items.flatMap((i) => i.affects))],
      sources,
      // The newest report in the story — its real publication time.
      createdUtc: new Date(cluster.lastSeenUtc).toISOString(),
      highConfidence: corroborated,
      eventId: null,
    });
  }

  return alerts;
}

/**
 * Several notable releases landing on one currency in a short window.
 *
 * Individually they may each be unremarkable; together they are a theme, and
 * that is exactly the pattern a trader watching one screen tends to miss.
 */
export function currencyClusterAlerts(
  scored: { event: NormalizedEvent; score: EventScore }[],
  now: Date,
): Alert[] {
  const byCurrency = new Map<Currency, { event: NormalizedEvent; score: EventScore }[]>();

  for (const item of scored) {
    if (item.score.surprise === null) continue;
    const ageHours = (now.getTime() - new Date(item.event.dateUtc).getTime()) / 3_600_000;
    if (ageHours < 0 || ageHours > CURRENCY_CLUSTER_WINDOW_HOURS) continue;
    // Only meaningful moves count toward a cluster.
    if (Math.abs(item.score.score) < 1.5) continue;

    const list = byCurrency.get(item.event.currency) ?? [];
    list.push(item);
    byCurrency.set(item.event.currency, list);
  }

  const alerts: Alert[] = [];

  for (const [currency, items] of byCurrency) {
    if (items.length < CURRENCY_CLUSTER_MIN) continue;

    // Only alert when they point the SAME way — three prints pulling in
    // opposite directions is noise, not a theme.
    const positive = items.filter((i) => i.score.score > 0).length;
    const negative = items.length - positive;
    const aligned = Math.max(positive, negative);
    if (aligned < CURRENCY_CLUSTER_MIN) continue;

    const direction = positive > negative ? 'bullish' : 'bearish';
    const avg =
      Math.round((items.reduce((sum, i) => sum + i.score.score, 0) / items.length) * 10) / 10;

    // Hash over the member events so the alert fires once per distinct cluster.
    const hash = stableId('alert', 'cluster', currency, ...items.map((i) => i.event.id).sort());

    alerts.push({
      id: hash,
      hash,
      kind: 'news-cluster',
      severity: Math.abs(avg) >= 4 ? 'high' : 'medium',
      title: `${currency}: ${aligned} aligned ${direction} releases in ${CURRENCY_CLUSTER_WINDOW_HOURS}h`,
      body:
        `${items.map((i) => i.event.name).slice(0, 4).join(', ')}. ` +
        `Average score ${avg > 0 ? '+' : ''}${avg}.`,
      affects: [currency],
      sources: [],
      // The latest member release completed the cluster.
      createdUtc: items.map((i) => new Date(i.event.dateUtc).toISOString()).sort().at(-1) as string,
      highConfidence: items.every((i) => i.score.confidence >= CONFIDENCE_FLOOR),
      eventId: null,
    });
  }

  return alerts;
}

/**
 * Only these reach the feed or a phone. `info` is kept inside the engine (a
 * low-confidence surprise still informs the dashboard's scores) but it is not an
 * alert: an interruption has to be worth the interruption.
 */
export const DELIVERED_SEVERITIES: readonly AlertSeverity[] = ['critical', 'high', 'medium'];

export function isDeliverable(alert: Alert): boolean {
  return DELIVERED_SEVERITIES.includes(alert.severity);
}

/** How long a stored alert stays in the feed. Older than this is history, not an alert. */
export const ALERT_DISPLAY_WINDOW_HOURS = 48;

/**
 * Whether a STORED alert still belongs in the feed.
 *
 * The store keeps every alert ever recorded, including ones stamped by older
 * code and ones from news feeds that have since been removed. Neither should
 * reappear: an alert has to be recent, and a news alert has to come from a feed
 * we still trust.
 */
export function isCurrentAlert(
  alert: Alert,
  now: Date,
  feedNames: ReadonlySet<string>,
  windowHours = ALERT_DISPLAY_WINDOW_HOURS,
): boolean {
  if (!isDeliverable(alert)) return false;
  const created = new Date(alert.createdUtc).getTime();
  if (!Number.isFinite(created)) return false;
  const ageHours = (now.getTime() - created) / 3_600_000;
  if (ageHours > windowHours) return false;
  if (alert.kind === 'geopolitical' || alert.kind === 'central-bank') {
    return alert.sources.length > 0 && alert.sources.every((s) => feedNames.has(s.name));
  }
  return true;
}

/** Runs every rule and returns alerts ordered most severe first. */
export function evaluateAlerts(input: {
  events: NormalizedEvent[];
  scored: { event: NormalizedEvent; score: EventScore }[];
  clusters: NewsCluster[];
  now: Date;
}): Alert[] {
  const { events, scored, clusters, now } = input;

  const all = [
    ...upcomingEventAlerts(events, now),
    ...surpriseAlerts(scored, now),
    ...newsAlerts(clusters, now),
    ...currencyClusterAlerts(scored, now),
  ];

  const order: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

  // Dedupe by hash within this run, then sort by severity.
  return [...new Map(all.map((a) => [a.hash, a])).values()].sort(
    (a, b) => order[a.severity] - order[b.severity] || b.createdUtc.localeCompare(a.createdUtc),
  );
}

export { CORROBORATION_DOMAINS };
