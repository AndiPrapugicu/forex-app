-- Supabase / Postgres schema.
-- Run once in the Supabase SQL editor (see README).
--
-- Single-user app: no RLS policies for multiple tenants, no auth tables. Access
-- is gated by the service key living only in server-side env vars.

-- ---------------------------------------------------------------------------
-- Economic calendar events
-- ---------------------------------------------------------------------------
create table if not exists events (
  id                      text primary key,
  series_id               text,
  name                    text not null,
  currency                text not null,
  date_utc                timestamptz not null,
  impact                  text not null,

  actual                  double precision,
  consensus               double precision,
  previous                double precision,
  revised                 double precision,
  unit                    text,

  ratio_deviation         double precision,
  is_better_than_expected boolean,

  is_speech               boolean not null default false,
  is_preliminary          boolean not null default false,

  source                  text not null,
  actual_source           text,
  source_url              text,
  last_updated            bigint,

  ingested_at             timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists events_date_idx     on events (date_utc desc);
create index if not exists events_currency_idx on events (currency, date_utc desc);

-- Manual overrides live in their own table rather than mutating `events`, so a
-- later feed sync can never silently clobber a number the user typed in, and a
-- disagreement between the two stays visible.
create table if not exists manual_actuals (
  event_id   text primary key,
  actual     double precision not null,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Computed scores (cached; always reproducible from events + config)
-- ---------------------------------------------------------------------------
create table if not exists event_scores (
  event_id          text primary key,
  currency          text not null,
  score             double precision not null,
  confidence        double precision not null,
  direction         text not null,
  surprise          double precision,
  trace             jsonb not null default '[]'::jsonb,
  polarity_conflict boolean not null default false,
  scored_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- News
-- ---------------------------------------------------------------------------
create table if not exists news_items (
  id               text primary key,
  title            text not null,
  url              text not null,
  domain           text not null,
  source_name      text not null,
  published_utc    timestamptz not null,
  summary          text,
  category         text not null,
  matched_keywords text[] not null default '{}',
  affects          text[] not null default '{}',
  ingested_at      timestamptz not null default now()
);

create index if not exists news_published_idx on news_items (published_utc desc);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
-- `hash` is the dedupe key. The ingest cron runs every 10 minutes over an
-- overlapping window, so without a unique constraint here the same alert would
-- be pushed to Telegram on every single run.
create table if not exists alert_log (
  hash            text primary key,
  kind            text not null,
  severity        text not null,
  title           text not null,
  body            text not null,
  affects         text[] not null default '{}',
  sources         jsonb not null default '[]'::jsonb,
  high_confidence boolean not null default false,
  event_id        text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);

create index if not exists alert_created_idx on alert_log (created_at desc);

-- ---------------------------------------------------------------------------
-- AI output cache
-- ---------------------------------------------------------------------------
-- Keyed by hash of (prompt kind + input content) so the same headline is never
-- paid for twice. `model` is stored so stale output from a swapped model is
-- identifiable rather than silently reused.
create table if not exists ai_cache (
  hash       text primary key,
  kind       text not null,
  model      text not null,
  output     jsonb not null,
  created_at timestamptz not null default now()
);
