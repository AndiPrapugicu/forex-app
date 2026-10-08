-- Run once in the Supabase SQL editor on a database created before 2026-10-03.
-- Safe to re-run. Identical to the positions block in lib/db/schema.sql.

create table if not exists positions (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null,
  side            text not null check (side in ('long', 'short')),
  entry_date      date not null,
  entry_price     double precision not null,
  stop_loss       double precision,
  take_profit     double precision,
  size            text,
  risk_pct        double precision,
  thesis          text check (thesis is null or char_length(thesis) <= 1000),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  close_price     double precision,
  last_status     text check (last_status is null or last_status in ('green', 'yellow', 'red')),
  last_status_at  timestamptz
);

create index if not exists positions_open_idx
  on positions (opened_at desc) where closed_at is null;

-- Private trades. RLS on with no policies: the anon and authenticated keys see
-- nothing, while the server's service key bypasses RLS as it always has.
alter table positions enable row level security;
