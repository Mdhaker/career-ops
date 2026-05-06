-- ============================================================
-- Career-Ops Web — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES
-- ============================================================
create table if not exists profiles (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  full_name         text,
  email             text,
  phone             text,
  location          text,
  linkedin          text,
  portfolio_url     text,
  github            text,
  headline          text,
  exit_story        text,
  target_roles      text[]    not null default '{}',
  archetypes        jsonb     not null default '[]',
  superpowers       text[]    not null default '{}',
  proof_points      jsonb     not null default '[]',
  comp_target       text,
  comp_minimum      text,
  comp_currency     text      not null default 'USD',
  remote_preference text,
  visa_status       text,
  cv_markdown       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can manage their own profile"
  on profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function handle_updated_at();

-- ============================================================
-- APPLICATIONS
-- ============================================================
create table if not exists applications (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  seq_num         bigint not null default extract(epoch from now()),
  date            date not null default current_date,
  company         text not null,
  role            text not null,
  score           numeric(3,1) check (score >= 1 and score <= 5),
  status          text not null default 'Evaluated'
                    check (status in ('Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP')),
  pdf_url         text,
  report_url      text,
  report_content  text,
  url             text,
  archetype       text,
  legitimacy      text check (legitimacy in ('High Confidence','Proceed with Caution','Suspicious')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table applications enable row level security;

create policy "Users can manage their own applications"
  on applications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger applications_updated_at
  before update on applications
  for each row execute function handle_updated_at();

create index if not exists applications_user_status_idx on applications(user_id, status);
create index if not exists applications_user_date_idx on applications(user_id, date desc);

-- ============================================================
-- FOLLOW-UPS
-- ============================================================
create table if not exists follow_ups (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  application_id  uuid not null references applications(id) on delete cascade,
  date            date not null default current_date,
  channel         text not null default 'Email'
                    check (channel in ('Email','LinkedIn','Other')),
  contact         text,
  notes           text,
  created_at      timestamptz not null default now()
);

alter table follow_ups enable row level security;

create policy "Users can manage their own follow-ups"
  on follow_ups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists follow_ups_application_idx on follow_ups(application_id);

-- ============================================================
-- TRACKED COMPANIES
-- ============================================================
create table if not exists tracked_companies (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  careers_url     text not null,
  api_url         text,
  api_provider    text check (api_provider in ('greenhouse','ashby','lever','bamboohr','teamtailor','workday')),
  scan_method     text not null default 'playwright'
                    check (scan_method in ('playwright','api','websearch')),
  notes           text,
  enabled         boolean not null default true,
  last_scanned_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table tracked_companies enable row level security;

create policy "Users can manage their own tracked companies"
  on tracked_companies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- SEARCH QUERIES
-- ============================================================
create table if not exists search_queries (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  query       text not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table search_queries enable row level security;

create policy "Users can manage their own search queries"
  on search_queries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- TITLE FILTERS
-- ============================================================
create table if not exists title_filters (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  positive        text[] not null default '{}',
  negative        text[] not null default '{}',
  seniority_boost text[] not null default '{}',
  updated_at      timestamptz not null default now()
);

alter table title_filters enable row level security;

create policy "Users can manage their own title filters"
  on title_filters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger title_filters_updated_at
  before update on title_filters
  for each row execute function handle_updated_at();

-- ============================================================
-- SCAN RUNS
-- ============================================================
create table if not exists scan_runs (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null default 'running'
                        check (status in ('running','completed','failed')),
  new_count           integer not null default 0,
  filtered_count      integer not null default 0,
  skipped_dup_count   integer not null default 0,
  skipped_expired_count integer not null default 0,
  log                 text
);

alter table scan_runs enable row level security;

create policy "Users can manage their own scan runs"
  on scan_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
-- Run these separately in Dashboard > Storage > New bucket
-- Or via Supabase CLI:
--
-- supabase storage buckets create pdfs --public false
-- supabase storage buckets create reports --public false
--
-- Then add storage policies:

insert into storage.buckets (id, name, public)
  values ('pdfs', 'pdfs', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('reports', 'reports', false)
  on conflict (id) do nothing;

create policy "Authenticated users can manage their pdfs"
  on storage.objects for all
  using (bucket_id = 'pdfs' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'pdfs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Authenticated users can manage their reports"
  on storage.objects for all
  using (bucket_id = 'reports' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'reports' and auth.uid()::text = (storage.foldername(name))[1]);
