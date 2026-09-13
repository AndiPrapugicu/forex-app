-- Run once in the Supabase SQL editor on a database created before 2026-09-13.
-- Safe to re-run. Identical to the options_snapshots block in lib/db/schema.sql.

create table if not exists options_snapshots (
  symbol              text    not null,
  session_date        date    not null,
  call_volume         double precision not null default 0,
  put_volume          double precision not null default 0,
  call_open_interest  double precision not null default 0,
  put_open_interest   double precision not null default 0,
  captured_at         timestamptz not null default now(),
  primary key (symbol, session_date)
);

create index if not exists options_snapshots_date_idx
  on options_snapshots (session_date desc);
