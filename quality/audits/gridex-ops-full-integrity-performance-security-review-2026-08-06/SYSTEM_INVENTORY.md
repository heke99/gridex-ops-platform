# System inventory

## Application stack

| Area | Verified state |
|---|---|
| Framework | Next.js `16.2.12`, App Router |
| UI runtime | React/React DOM `19.2.4` |
| Database client | `@supabase/supabase-js ^2.100.0`, `@supabase/ssr ^0.9.0` |
| Validation | Zod `^3.24.1` |
| Test runner | Vitest `4.1.9` |
| Runtime | Node `>=22 <23`, npm `10.9.2` |
| Major external libraries | `imapflow`, `ldapts`, `node-forge`, `nodemailer`, `resend` |
| API version | website/customer portal contract `2026-08-05.2` in current and immutable artifacts |

## API surface

Current `app/api/v1` includes grouped routes for:

- public contracts and diagnostics;
- website contracts, quote creation/validation, applications, energy-area resolution, legal bundles, market/portfolio prices, customer events and switch status;
- customer portal sync plus customer contracts, documents, events, invoices, legal acceptances, identity, metering values, move-out, notifications, powers of attorney, profile, sites and portal bundle;
- integration context and events;
- immutable OpenAPI routes from `2026-08-02.1` through `2026-08-05.2`, current snapshots and release manifest.

Large route-source files by repository byte size include customer portal sync (~14 KB), portal bundle (~14.6 KB), website public contracts (~13 KB), quote (~12 KB), quote validation (~10.4 KB) and customer applications (~9.3 KB). These sizes are not bundle measurements.

## Supabase database inventory

Direct current catalog inspection of `gridex-ops-dev`:

| Object | Count |
|---|---:|
| Public tables | 489 |
| Public views | 155 |
| Public indexes | 2,201 |
| RLS policies (`public`/`staging`) | 3,866 |
| Tables with policies | 430 |
| Functions (`public`/`staging`) | 507 |
| `SECURITY DEFINER` functions | 299 |
| Authenticated-executable definers | 11 |
| Anon-executable definers | 0 |

Installed extensions: `plpgsql`, `pg_stat_statements`, `pgcrypto`, `pg_graphql`, `uuid-ossp`, `supabase_vault`, `pg_cron`, `pg_net`, `pgjwt`.

One Edge Function was visible: `auto-delete-old-users`, active, version 5, JWT verification enabled.

## Domain map

| Domain | Primary canonical objects / paths | Principal lifecycle |
|---|---|---|
| Companies/tenants | `companies`, `company_memberships`, user context helpers | onboarding -> active -> suspended/archived/deleted |
| Identity/RBAC | `auth.users`, `user_profiles`, `admin_users`, `user_roles`, `roles`, `permissions`, `role_permissions` | invited/active/disabled/removed |
| Customers/sites | `customers`, customer sites/metering point flows, customer API routes | application -> customer -> active/closed |
| Contracts/offers/pricing | public offers, publication/legal/price versions, website quotes | draft -> published/locked -> selected/validated |
| Applications | website customer application orchestration and supporting tables | received -> validated -> provisioned/review/failed |
| Supplier switching/POA | switch requests, outbound requests, powers of attorney | blocked/queued/awaiting/ready/completed/failed |
| Actor registry/EDIEL | actors, routes, certificates, imports, conflicts, refresh jobs | imported/verified/active/expired/error |
| Integration/API clients | integration clients, requests, inbox/outbox, webhooks | active/revoked; received/processed/retried/failed |
| Notifications/documents | email outbox/runs, storage buckets, legal/customer docs | queued/sent/failed; uploaded/published/retained |
| Audit/observability | audit logs, masterdata audit, request IDs, platform events | append/retain/archive |

## Environment inventory

Only `gridex-ops-dev` was connected. Production database, a separate staging database, Vercel environment variables, deployment aliases, branch protection rules beyond the visible unprotected `main`, external providers and customer tenant repositories were not available.