-- Run this once against the Supabase project AFTER the initial
-- `pnpm db:migrate` (Prisma migration) has created all tables.
-- Not run automatically: Prisma's schema DSL doesn't model pgvector or RLS
-- policies, so this is applied by hand via
-- `prisma db execute --file post-migration.sql --schema prisma/schema.prisma`
-- or pasted into the Supabase SQL editor.
--
-- NOTE: table names are snake_case (via Prisma `@@map`), but COLUMN names
-- are still camelCase (no per-field `@map` was added to the schema) — every
-- column reference below is double-quoted to match exactly what Prisma
-- generated (Postgres folds unquoted identifiers to lowercase otherwise).

-- ---------- pgvector: job description embeddings for dedup similarity ----------

create extension if not exists vector;

alter table jobs add column if not exists "descriptionEmbedding" vector(1536);

create index if not exists jobs_description_embedding_idx
  on jobs using ivfflat ("descriptionEmbedding" vector_cosine_ops)
  with (lists = 100);

-- ---------- pg_trgm: fuzzy company-name matching for dedup ----------

create extension if not exists pg_trgm;

create index if not exists companies_canonical_name_trgm_idx
  on companies using gin ("canonicalName" gin_trgm_ops);

-- ---------- Row Level Security ----------
-- Defense-in-depth only: application traffic authorizes via server-side
-- userId scoping using the service-role connection, which bypasses RLS.
-- These policies protect any path that ever uses a browser-side Supabase
-- client directly (Storage signed URLs, future Realtime subscriptions).

alter table users enable row level security;
create policy "users_self" on users
  for all using (id = auth.uid()::text) with check (id = auth.uid()::text);

alter table profiles enable row level security;
create policy "profiles_owner" on profiles
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table resumes enable row level security;
create policy "resumes_owner" on resumes
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table resume_versions enable row level security;
create policy "resume_versions_owner" on resume_versions
  for all using (
    exists (select 1 from resumes r where r.id = resume_versions."resumeId" and r."userId" = auth.uid()::text)
  );

alter table user_skills enable row level security;
create policy "user_skills_owner" on user_skills
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table applications enable row level security;
create policy "applications_owner" on applications
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table application_answers enable row level security;
create policy "application_answers_owner" on application_answers
  for all using (
    exists (select 1 from applications a where a.id = application_answers."applicationId" and a."userId" = auth.uid()::text)
  );

alter table application_events enable row level security;
create policy "application_events_owner" on application_events
  for all using (
    exists (select 1 from applications a where a.id = application_events."applicationId" and a."userId" = auth.uid()::text)
  );

alter table application_state_history enable row level security;
create policy "application_state_history_owner" on application_state_history
  for all using (
    exists (select 1 from applications a where a.id = application_state_history."applicationId" and a."userId" = auth.uid()::text)
  );

alter table cover_letters enable row level security;
create policy "cover_letters_owner" on cover_letters
  for all using (
    exists (select 1 from applications a where a.id = cover_letters."applicationId" and a."userId" = auth.uid()::text)
  );

alter table tailored_resumes enable row level security;
create policy "tailored_resumes_owner" on tailored_resumes
  for all using (
    exists (select 1 from applications a where a.id = tailored_resumes."applicationId" and a."userId" = auth.uid()::text)
  );

alter table job_matches enable row level security;
create policy "job_matches_owner" on job_matches
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table saved_searches enable row level security;
create policy "saved_searches_owner" on saved_searches
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table job_alerts enable row level security;
create policy "job_alerts_owner" on job_alerts
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table settings enable row level security;
create policy "settings_owner" on settings
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table outreach_campaigns enable row level security;
create policy "outreach_campaigns_owner" on outreach_campaigns
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table outreach_messages enable row level security;
create policy "outreach_messages_owner" on outreach_messages
  for all using (
    exists (select 1 from outreach_campaigns c where c.id = outreach_messages."campaignId" and c."userId" = auth.uid()::text)
  );

alter table outreach_events enable row level security;
create policy "outreach_events_owner" on outreach_events
  for all using (
    exists (
      select 1 from outreach_messages m
      join outreach_campaigns c on c.id = m."campaignId"
      where m.id = outreach_events."messageId" and c."userId" = auth.uid()::text
    )
  );

alter table connected_accounts enable row level security;
create policy "connected_accounts_owner" on connected_accounts
  for all using ("userId" = auth.uid()::text) with check ("userId" = auth.uid()::text);

alter table ai_runs enable row level security;
create policy "ai_runs_owner" on ai_runs
  for all using ("userId" = auth.uid()::text);

alter table ai_usage enable row level security;
create policy "ai_usage_owner" on ai_usage
  for all using ("userId" = auth.uid()::text);

alter table audit_logs enable row level security;
create policy "audit_logs_owner" on audit_logs
  for select using ("userId" = auth.uid()::text);

-- Shared reference tables: any authenticated user may read; writes only
-- happen server-side via the service-role connection (which bypasses RLS),
-- so no insert/update/delete policy is granted here by design.

alter table skills enable row level security;
create policy "skills_read" on skills for select using (auth.role() = 'authenticated');

alter table companies enable row level security;
create policy "companies_read" on companies for select using (auth.role() = 'authenticated');

alter table company_sources enable row level security;
create policy "company_sources_read" on company_sources for select using (auth.role() = 'authenticated');

alter table company_contacts enable row level security;
create policy "company_contacts_read" on company_contacts for select using (auth.role() = 'authenticated');

alter table jobs enable row level security;
create policy "jobs_read" on jobs for select using (auth.role() = 'authenticated');

alter table job_sources enable row level security;
create policy "job_sources_read" on job_sources for select using (auth.role() = 'authenticated');

alter table job_skills enable row level security;
create policy "job_skills_read" on job_skills for select using (auth.role() = 'authenticated');

-- ---------- Supabase Storage: resumes bucket ----------
-- Run once: create the bucket (private) if it doesn't already exist.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Object paths are "resumes/{userId}/{resumeId}/{filename}" — restrict access
-- to the path's owning user.
create policy "resumes_bucket_owner_select" on storage.objects
  for select using (
    bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "resumes_bucket_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "resumes_bucket_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- auth.users -> public.users sync ----------
-- Creates the corresponding public.users/profiles/settings rows on signup.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, "createdAt", "updatedAt")
  values (new.id, new.email, now(), now());
  insert into public.profiles (id, "userId", "createdAt", "updatedAt")
  values (gen_random_uuid(), new.id, now(), now());
  insert into public.settings (id, "userId", "createdAt", "updatedAt")
  values (gen_random_uuid(), new.id, now(), now());
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- External application tracking (email-detected, non-portal applications) ----------
-- Applied out-of-band (like the pgvector column above) because `prisma migrate dev`
-- sees pre-existing drift from that same pgvector column and wants to reset the DB.
DO $$ BEGIN
  CREATE TYPE "ApplicationSource" AS ENUM ('PORTAL', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "source" "ApplicationSource" NOT NULL DEFAULT 'PORTAL';
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "isExternalStub" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Email intent classification (AI fallback for the email status scanner) ----------
ALTER TYPE "AITaskType" ADD VALUE IF NOT EXISTS 'EMAIL_CLASSIFICATION';

-- ---------- Adzuna job source (real public search API) ----------
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'ADZUNA';
