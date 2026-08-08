/**
 * Telegram delivery.
 *
 * Optional by design: with no bot token configured the app runs normally and
 * alerts simply stay in the in-app feed. A missing integration must never break
 * ingest.
 */

import type { Alert, AlertSeverity } from '@/lib/types';

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  info: '⚪',
};

/** Telegram rejects unescaped markup; escape everything user-facing. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatAlert(alert: Alert): string {
  const icon = SEVERITY_ICON[alert.severity];
  const confidence = alert.highConfidence ? '' : '\n<i>⚠ Not corroborated</i>';

  const affects = alert.affects.length ? `\n<b>Affects:</b> ${alert.affects.join(', ')}` : '';

  // Source links are mandatory context — an alert the user cannot verify is
  // just an assertion.
  const sources = alert.sources.length
    ? '\n\n' +
      alert.sources
        .slice(0, 3)
        .map((s) => `<a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>`)
        .join(' · ')
    : '';

  const time = alert.createdUtc.slice(11, 16);

  return (
    `${icon} <b>${escapeHtml(alert.title)}</b>\n\n` +
    `${escapeHtml(alert.body)}` +
    affects +
    confidence +
    sources +
    `\n\n<i>${time} UTC</i>`
  );
}

export interface TelegramResult {
  sent: number;
  failed: number;
  skipped: boolean;
  error?: string;
}

/**
 * Sends alerts to Telegram.
 *
 * Failures are counted and returned, never thrown — a Telegram outage must not
 * stop the ingest run that produced the alerts, or the app would lose data over
 * a notification problem.
 */
export async function sendAlerts(alerts: Alert[]): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: 0, failed: 0, skipped: true, error: 'Telegram not configured' };
  }
  if (alerts.length === 0) {
    return { sent: 0, failed: 0, skipped: false };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const alert of alerts) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: formatAlert(alert),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        sent++;
      } else {
        failed++;
        firstError ??= `HTTP ${res.status}`;
      }
    } catch (err) {
      failed++;
      firstError ??= err instanceof Error ? err.message : String(err);
    }

    // Telegram allows ~30 messages/second; a small gap keeps a burst of alerts
    // from tripping the limit and losing the tail of the batch.
    if (alerts.length > 1) await new Promise((r) => setTimeout(r, 120));
  }

  return { sent, failed, skipped: false, error: firstError };
}
