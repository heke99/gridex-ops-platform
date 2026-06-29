# Gridex OPS Platform

Gridex OPS is a production-oriented, multi-tenant SaaS platform for Swedish
electricity retailers and energy-service companies. It covers customer
onboarding, customer cards, sites/anläggningar, metering points, powers of
attorney (fullmakter), supplier switching, grid-owner communication, Ediel
(PRODAT/UTILTS/APERAK/CONTRL), billing underlay, and platform billing against
tenant companies.

It is built as a reusable SaaS platform — Div3rsa AB is one tenant, never a
hardcoded special case. All sensitive operational flows are company/tenant
scoped, and production runs on Vercel.

> Read `docs/ai-context/00_PROJECT_SNAPSHOT.md`, `docs/ai-context/01_CURSOR_WORKFLOW.md`
> and `docs/ai-context/11_CURRENT_TASK.md` before changing code. `AGENTS.md` notes
> this Next.js version has breaking changes vs. older docs — consult
> `node_modules/next/dist/docs/` when in doubt.

## Tech stack

- Next.js 16 (App Router, React 19, React Compiler) — `next build --webpack`
- Supabase (Postgres + RLS) via `@supabase/supabase-js` / `@supabase/ssr`
- TypeScript, Tailwind CSS v4, Zod
- Server libs only on the server: `nodemailer`, `imapflow`, `node-forge`, `ldapts`, `resend`

## Local setup

```bash
npm install
npm run dev          # http://localhost:3000
```

Validation:

```bash
npm run lint
npm run typecheck
npm run build
npm run db:migrations:check   # unique 14-digit migration prefixes
npm run security:rbac         # platform/tenant RBAC + service-role allowlist
```

## Environment variables (by category)

Set these in Vercel (and `.env.local` for development). See
`docs/ai-context/16_SECURITY_SECRETS_CERTIFICATES.md` for the authoritative list.

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server only — never exposed to the browser).
- **Email / Resend**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`.
- **Manual operations mailbox** (leverantörsbyte@gridex.se): `MANUAL_OPS_IMAP_PASS`,
  `MANUAL_OPS_SMTP_PASS`. Sender identity is configured per tenant in
  `manual_communication_mailboxes`; delivery is via Resend.
- **Cron / internal route secrets**: `CRON_SECRET` (shared fallback) plus the
  per-job secrets `CUSTOMER_OPERATION_CRON_SECRET`, `EMAIL_OUTBOX_CRON_SECRET`,
  `MANUAL_EMAIL_OUTBOX_CRON_SECRET`, `MANUAL_INBOUND_CRON_SECRET`,
  `EDIEL_INBOUND_CRON_SECRET`, `GRIDEX_CRON_SECRET`, `OPS_HEALTH_CRON_SECRET`,
  `GRID_AREA_IMPORT_CRON_SECRET`. Internal routes return `503` if no secret is
  configured and compare secrets in a timing-safe way.
- **Facility lookup channel**: `GRIDEX_FACILITY_LOOKUP_CHANNEL` (`manual_email`
  default; `ediel` opt-in). `MANUAL_EMAIL_ALLOW_EDIEL_SENDER` is an emergency
  override that is surfaced in superadmin diagnostics.

## Supabase migration workflow

- Migrations live in `supabase/migrations/` and are named
  `YYYYMMDDHHMMSS_descriptive_slug.sql` (14-digit, unique prefix).
- `npm run db:migrations:check` fails on duplicate timestamp prefixes.
- Migrations must be **non-destructive and production-safe**: never drop history,
  never break old production data. CHECK changes use drop-and-recreate with the
  full value set; backfills normalize data before tightening constraints.

## Tenant vs. superadmin model

- **Tenant admins** work from business-friendly screens (customer card,
  `/admin/facility-requests`, `/admin/work-queue`) and see plain status, missing
  data and next action — never raw EDIFACT/PRODAT/route internals.
- **Superadmin/platform** screens may show advanced diagnostics, mailboxes,
  legal readiness, data cleanup and cross-tenant observations.
- Tenant identity is resolved from the API key / Ediel routing — never from a
  client-submitted `company_id`. RLS enforces tenant isolation; service-role
  access is server-only.

## APIs

### Website integration API (`/api/v1/website/*`)
External tenant websites create customer applications and read published
contracts. Auth is a tenant API key (`Authorization: Bearer …`). See
[docs/external-website-api-integration-guide.md](docs/external-website-api-integration-guide.md)
and [docs/ops-api-customer-intake-facility.md](docs/ops-api-customer-intake-facility.md).

Key contract rules:

- API keys must **never** be exposed in browser/client JavaScript.
- Websites send only `offer_reference` for contracts — never internal OPS
  `company_id`, `customer_id`, `price_plan_id` or `contract_id`.
- Customer identity normalizes to `private` | `business` (aliases auto-mapped).
- `powerOfAttorney` (camelCase) is required when the contract publishes a POA
  version (`legal.power_of_attorney_required = true`); `consents.power_of_attorney = true`
  alone is **not** enough.
- A successful application returns `power_of_attorney_id` and a `power_of_attorney`
  block. Errors are always JSON in the shape
  `{ error: { code, message, stage, field, request_id } }`.
- Send an `Idempotency-Key`; repeated calls do not create duplicates.

### Customer portal API (`/api/v1/customer/*`)
A tenant backend (never the browser) reads Mina sidor data with its API key. See
[docs/gridex-customer-portal-api.md](docs/gridex-customer-portal-api.md). Tenant
identity comes from the key; the customer is resolved by linked portal identity,
then `external_customer_id`, `customer_number`, then unique email. Customers can
never reach another customer's or tenant's data.

## Legal / fullmakt flow

OPS is the single source of truth for legal text and powers of attorney. Public
contracts and the legal bundle expose `*_required`, `*_version_id` and public
OPS-hosted `*_url` links. A structured `powerOfAttorney` creates a real
`powers_of_attorney` row plus immutable `customer_legal_acceptances`. A weak
`consents.power_of_attorney: true` is recorded as a legal acceptance but is
marked `externally_sendable: false` and is never sent to a grid owner. See
[docs/legal-power-of-attorney-platform.md](docs/legal-power-of-attorney-platform.md).

## Manual mailbox vs. Ediel mailbox

- **Manual mailbox** `leverantorsbyte@gridex.se` (`manual_communication_mailboxes`)
  handles human-readable grid-owner emails — used when a facility/anläggnings-id
  is missing. It is driven by `manual_email_outbox` and inbound matching, and is
  never the Ediel transport sender.
- **Ediel mailbox** `ediel@gridex.se` is for encrypted EDIFACT only. A missing
  facility id never renders a PRODAT Z01 or creates an `ediel_outbox` row.

## Archive vs. delete

Real customers are **archived** (`status = archived`), not hard-deleted: they
leave the normal tenant list, appear in the archive, keep their history, and
operational actions are blocked. Hard delete is reserved for clean test data with
no protected history and is platform-admin only.

## Validation & regressions

The platform ships many focused regression scripts (see `package.json`), e.g.:

```bash
npm run gridex:website-api-power-of-attorney-regression
npm run gridex:legal-poa-platform-hardening-regression
npm run gridex:manual-grid-owner-information-request-regression
npm run gridex:customer-card-tenant-ux-regression
npm run gridex:ediel-intent-pipeline-full-regression
```

## Security notes

- RLS is enabled on tenant tables; service-role operations are server-only.
- Cron/internal routes require a secret; webhooks verify signatures.
- Never log raw secrets; error messages must not leak sensitive internals.
- Public website endpoints expose only public offer/legal data.
