# AI Job Hunter — Architecture

This is the as-built architecture reference for the personal AI job-hunting platform. It reflects
what's actually implemented, including a few real-world gotchas discovered while building it (see
"Lessons learned" — these aren't hypothetical, they were hit and fixed during development).

See `/Users/tanisha/.claude/plans/build-personal-ai-shiny-cupcake.md` for the original approved plan.
This document supersedes it where the two disagree (a few things changed during implementation — noted
inline).

## Product scope (Phase 1, this build)

- **Web portal**: profile, resume manager, AI job discovery/matching, application preparation +
  "apply to all" approval queue, company/HR outreach with cold-email drafting.
- **Explicitly deferred**: a mobile "Apply Assistant" plugin (Track B) — Indeed/Naukri/Cutshort have
  no public individual-facing API and prohibit bot interaction, so any future version of that is a
  WebView-based assist-only tool, not full automation. Nothing for it is built yet.
- **Non-negotiable rules enforced throughout**: never claim an application/email was sent when it
  wasn't; never fabricate resume content, contact info, or answers; AI never controls deterministic
  business logic (state transitions, filters, rate limits) — it only generates/classifies/scores,
  with deterministic code as the gatekeeper everywhere a side effect happens.

## Monorepo layout

```
Hunter/
├── apps/web/              Next.js 16 (App Router), Supabase Auth, Tailwind v4
├── packages/
│   ├── config/             env schema (zod), shared tsconfig
│   ├── db/                 Prisma schema + client (the only package that imports @prisma/client)
│   ├── ai/                 AIProvider abstraction — pure, no DB/Next.js imports
│   ├── core/                all business logic, orchestration, and persistence
│   ├── adapters/            job-board adapters (Greenhouse/Lever/Ashby/SmartRecruiters/etc.)
│   └── ui/                  shared design system (light theme only)
```

**Dependency direction**: `apps/web` → `core` / `ai` / `adapters`. `core` is the only package that
calls into `ai` (via `packages/core/src/ai/ai-client.ts`, which wraps every AI call with `ai_runs`/
`ai_usage` logging). **`core` does NOT depend on `adapters`** — `adapters` depends on `core` for the
shared `NormalizedJob`/`AtsType` types, so the reverse would be a circular dependency. Concretely: job
ingestion (`core`'s `ingestJob`) takes an already-fetched `NormalizedJob`; `apps/web`'s Server Actions
are the layer that calls an adapter (`@hunter/adapters`) and feeds the result into `core`.

## Data model

Full Prisma schema in `packages/db/prisma/schema.prisma` (27 tables). Key points:

- **Tables are snake_case** (via `@@map`), but **columns are camelCase** (no per-field `@map` was
  added) — any raw SQL against this DB must double-quote column names (`"userId"`, not `user_id`).
  This bit us once already: `packages/db/prisma/post-migration.sql`'s RLS policies and the
  `pg_trgm` index all had to be written with quoted camelCase identifiers, and `auth.uid()` (returns
  `uuid`) had to be cast to `::text` to compare against our `text`-typed `id`/`userId` columns.
- `Job` is canonical (`Job.id` **is** the `canonicalJobId`); `JobSource` rows (unique on
  `(atsType, externalId)`) point at it, `isPrimary` marks which source backs the canonical fields.
- `ApplicationStatus` uses the exact state list from the product spec: `DISCOVERED, MATCHED,
  SHORTLISTED, PREPARING, READY_FOR_REVIEW, APPROVED, SUBMITTED, FAILED, RECRUITER_REPLIED,
  SCREENING, INTERVIEW, TECHNICAL, HR, OFFER, REJECTED, WITHDRAWN`. Every transition is written by
  `packages/core/src/applications/application-state-machine.ts`'s `transition()` — nothing else is
  allowed to write `Application.status` directly. `ApplicationStateHistory` is the append-only audit
  trail funnel analytics are computed from.
- `Job.descriptionEmbedding` is a `pgvector(1536)` column **not declared in `schema.prisma`** (Prisma
  can't model `vector` natively) — it's added via `post-migration.sql`, and all reads/writes to it in
  `job-ingestion-service.ts` go through `$queryRaw`/`$executeRaw`.
- RLS is enabled on every table as defense-in-depth (see `post-migration.sql`) — the actual
  authorization boundary is server-side `userId` scoping via the service-role Prisma connection.

**Setup**: after `pnpm db:migrate` (runs `prisma migrate dev`), you must also run
`packages/db/prisma/post-migration.sql` once by hand (`prisma db execute --file
prisma/post-migration.sql --schema prisma/schema.prisma`) — it enables `vector`/`pg_trgm`, creates all
RLS policies, creates the `resumes` Storage bucket + its policies, and installs the
`auth.users → public.users/profiles/settings` signup trigger. This has been run against the live
Supabase project already; re-run it if the schema is ever reset.

## AI provider abstraction (`packages/ai`)

`AIProvider.generateStructured()` is the only generation entry point — every call is schema-validated
by construction (no free-text-then-parsed path exists). `packages/core/src/ai/ai-client.ts` wraps this
with DB logging (`ai_runs`/`ai_usage`) and is the only thing `core`'s agents call.

**Current default: Google Gemini** (`GoogleProvider`), not Anthropic, per an explicit choice to avoid
Anthropic billing for now. `AnthropicProvider` is fully implemented and the `ANTHROPIC_API_KEY` is
already configured — switching the default back is a one-line change in
`packages/ai/src/provider/model-router.ts`'s `DEFAULT_TASK_MODEL_CONFIG`.

### Lessons learned running structured output against Gemini (verified empirically, not theoretical)

These are load-bearing — reverting any of them breaks resume parsing:

1. **Zod tuples don't work.** `z.tuple([a, b])` renders as a JSON-Schema list-style `items`, which
   Gemini's `responseSchema` proto rejects outright (400 `INVALID_ARGUMENT`). Use an object instead
   (`z.object({start, end})`).
2. **`.default(...)` on a field silently breaks extraction.** A defaulted field is dropped from the
   JSON-Schema `required` list. Given a schema where every array field had `.default([])`, Gemini
   validly satisfied the schema by returning `{contact: {...}}` and omitting every other field
   entirely (confirmed: resume with real experience/skills/education came back with `experience: []`,
   `skills: []` etc.). Fix: every field in an AI-output schema (`packages/core/src/domain/resume.ts`,
   `job-extraction-agent.ts`) is a plain required type — no `.default()`.
3. **Gemini's "thinking" mode can eat the entire output budget, or degenerate.** Default (unbounded)
   thinking consumed all of `maxOutputTokens` before emitting any real JSON (same empty-fields
   symptom as #2, different cause). Setting `thinkingConfig.thinkingBudget: 0` fixed that but
   introduced a different failure: the model occasionally got stuck in a token-repetition loop (e.g.
   repeating `"2021\n"` thousands of times inside a date field until truncation). A **small non-zero
   budget (1024)** avoided both failure modes in testing. See `packages/ai/src/provider/providers/
   google.ts` for the exact config and a `generateStructured` retry-once wrapper for the rare
   remaining invalid-JSON/schema-validation failure.
4. **Free tier is capped at 20 requests/day per model**, not just rate-limited per-minute (confirmed
   via a live 429 `RESOURCE_EXHAUSTED` with `limit: 0` for the "pro" tier, and `limit: 20` for
   "flash"). Only flash-tier models have any free quota at all. This is fine for light testing but
   not for real usage volume — raise it via Google Cloud billing, or switch the default provider back
   to Anthropic (see above) once its small credit top-up is added.
5. **Model names roll forward fast.** Use rolling aliases (`gemini-flash-latest`,
   `gemini-embedding-001`), not a pinned version — a hardcoded `gemini-2.5-flash` 404'd
   ("no longer available to new users") within the same session this was built in.
6. **Embeddings need explicit dimensionality.** `gemini-embedding-001` natively outputs 3072 dims;
   our `pgvector(1536)` column requires passing `outputDimensionality: 1536` in the request (Matryoshka
   truncation) — otherwise the write fails on a dimension mismatch.

## Adapters (`packages/adapters`)

Greenhouse, Lever, Ashby, SmartRecruiters (all real public APIs, `automatedApply: false`), a generic
career-page adapter (robots.txt-respecting, JSON-LD-first, AI-extraction fallback — no headless-browser
bot evasion), a manual-paste adapter (AI extraction is the *primary* path here), and honest
`NOT_CONNECTED` stubs for Indeed/Naukri/Cutshort that throw `AdapterNotConnectedError` with a clear
explanation rather than returning silent empty results.

## Job ingestion + dedup (`packages/core/src/jobs`, `packages/core/src/dedup`)

`ingestJob()`: AI backfill of missing structured fields (`job-extraction-agent.ts`, only called when a
field is actually missing) → company resolution (exact domain → exact canonical name → `pg_trgm` fuzzy
match, in that trust order) → job-level dedup (identity keys first — `(atsType, externalId)`, then
normalized `applicationUrl` — then Jaccard token-overlap on description, escalating to an embeddings
cosine-similarity check only for the ambiguous 0.4–0.6 band) → persistence.

## Matching engine (`packages/core/src/matching`)

`evaluateHardRejectionRules()` runs first and is 100% deterministic — no AI call, cannot be overridden
by an AI opinion, each rule individually override-able. `JobMatchingService.runJobMatch()` then
computes deterministic scores (location/salary/experience/seniority/education — pure logic) and calls
`JobMatchingAgent` for the four inherently-semantic dimensions (skill/role/domain/career-goal) plus a
narrative, grounded by passing the deterministic scores in as context so the model can't introduce a
skill/concern not actually present in the job's requirements or the candidate's resume.

## Application agent (`packages/core/src/applications`)

`prepareApplication()`: select resume (deterministic tag/domain match) → `ResumeTailorAgent` proposes a
plan → `validateTailoredResumePlan()` (deterministic anti-fabrication gate: every bullet must cite a
real source id, and an entity-diff check catches paraphrase-introduced fabrication even when the id is
correct) → `CoverLetterAgent` (same grounding pattern, plus a boilerplate-phrase denylist) →
`resolveApplicationAnswers()` (profile fields are **never** AI-authored, by type — see
`answer-resolution-service.ts`; open-ended questions go through the AI only when nothing else applies,
and low-confidence/failed answers become `needsUserInput`, hard-blocking automation for that question).

`application-state-machine.ts` is the single writer of `Application.status`. `READY_FOR_REVIEW →
APPROVED` is always an explicit user action; `APPROVED → SUBMITTED` only happens via adapter
confirmation (none currently support it) or the user explicitly confirming a manual submission — the
UI never assumes a manual application was submitted.

## Apply-to-all queue (`packages/core/src/queue/apply-batch-service.ts`)

`createApplyBatch()` finds `MATCHED`/`SHORTLISTED` jobs at/above the effective threshold, re-validates
hard-rejection rules, and prepares each via the Application Agent into `READY_FOR_REVIEW`. **No
currently-registered adapter supports automated submission**, so every prepared application is
`manualActionRequired: true` — this is a fact about the current adapter set, not a hardcoded
pessimism; it should be revisited if an adapter with `automatedApply: true` is ever added. Approval
(`approveApplications`) is always an explicit user action, batched or single.

## Command Center (`packages/core/src/commands`)

`parseCommand()` (AI, fixed intent enum, cannot execute anything itself) → `dispatchCommand()`
(deterministic switch, re-validates confidence/filter sanity, is the only thing that calls real service
functions). The confirmation message shown to the user is built from the dispatcher's real return
value, never generated by the LLM after the fact.

## Outreach (`packages/core/src/outreach`)

Contacts are never fabricated: manual entry (HIGH confidence if the user marks it verified), a
pattern-guess suggestion (`careers@domain.com` etc., always LOW confidence, never auto-sent), and an
optional paid enrichment API (`EMAIL_DISCOVERY_PROVIDER=hunter`, off by default). Cold email generation
uses the same grounding/traceability approach as cover letters. **Sending is not implemented** —
`sendMessage()` throws an honest "not implemented, OAuth app setup required" error rather than faking a
send; the `ConnectedAccount` model and encrypted-token storage (`packages/core/src/security/crypto.ts`,
AES-256-GCM) are ready for when Gmail/Outlook OAuth is built. Today, drafts move DRAFT → QUEUED →
(user manually sends and clicks "I sent this manually") → SENT.

## Dashboard (`packages/core/src/analytics/dashboard-queries.ts`)

Pure deterministic SQL aggregation, no AI. Funnel/rate metrics ("ever reached interview") are computed
from `ApplicationStateHistory` since current `status` alone can't answer that.

## Security

Supabase Auth + RLS (see Data model above); `ConnectedAccount` tokens and any future stored credential
use AES-256-GCM (`ENCRYPTION_KEY`, never in the repo); every Server Action validates input with zod
before touching a repository; `logAudit()` (`packages/core/src/security/audit.ts`) is the single audit
entry point, called from the Server Action layer, not from within domain logic.

## Local setup

1. `pnpm install` at the repo root.
2. Copy `.env.example` → `.env` (and also into `packages/db/.env` and `apps/web/.env.local` — Prisma
   and Next.js each look for their own `.env` file location; see the note in those files if this
   changes). Fill in Supabase project URL/anon/service-role keys, `GOOGLE_AI_API_KEY` (and/or
   `ANTHROPIC_API_KEY`), and generate `ENCRYPTION_KEY` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. `pnpm --filter @hunter/db exec prisma migrate dev` then run `post-migration.sql` once (see Data
   model above).
4. `pnpm --filter web dev` (or `pnpm dev` from root via Turborepo).

**Note on shell + secrets**: if a DB password contains a `$`, do NOT `source` the `.env` file in bash —
bash will try to expand `$X` as a variable, silently corrupting the password. For ad-hoc scripts, use
Node's own `--env-file=path/to/.env` flag instead of bash `source`.

**Note on Next.js's env loader specifically**: unlike Prisma's CLI, **Next.js's built-in `.env`
loading expands unescaped `$VAR` references** (a documented feature for cross-referencing variables
between env vars). This bit us for real: `apps/web/.env.local`'s DB password contains a literal `$`,
and Next.js was silently mangling it, producing a genuine `PrismaClientInitializationError:
Authentication failed` at runtime — a plain Node script reading the same `.env` file worked fine
(no expansion), which is what made it confusing at first. Fix: escape it as `\$` in
`apps/web/.env.local` specifically. The root `.env` and `packages/db/.env` (read by Prisma's CLI, no
expansion) must keep the *unescaped* form — do not copy one file's DB URL over the other's.

## Known gaps / next steps

- Job/Applications/Outreach/Settings pages are functional but minimal — no pagination, no rich
  filtering UI yet.
- Gmail/Outlook OAuth (real outreach sending) not built.
- Mobile "Apply Assistant" (Track B) not started — needs a per-platform ToS/feasibility review first.
- No automated test suite yet (unit tests for the pure logic — hard-rejection rules, scoring, state
  machine, dedup matching keys, tailor validator — would be cheap and valuable to add).
- Gemini free-tier's 20 req/day cap means real usage needs either Google Cloud billing or switching
  the default provider to Anthropic.
