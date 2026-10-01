# Tenantservice side track: checkpoint

Status: #425 MERGED (squash `d548e23`). Follow-up in progress. Last updated 2026-10-01 ~20:40 UTC.

Separate from the Ediel checkpoint (`checkpoint.json`). Do not overwrite that file.

## Where things stand
- **Branch:** `claude/bold-edison-vgwx65`.
- **Draft PR:** heke99/gridex-ops-platform#425, watched.
- **Evidence:**
  - `quality/tenantservice/P0-inventory-and-findings.md` (findings register F1–F16);
  - `quality/tenantservice/P7-P8-threat-model-and-rollout.md` (threat model, ASVS, rollout, rollback).
- **User decisions (2026-10-01):**
  - Continue the plan.
  - Merge to main **when everything is done and CI is green**.
  - Fix red CI.
  - Always keep agent memory up to date.
- **Merging to main = production deploy** (`vercel-production-deploy.yml`).
  - Behaviour changes are behind flags whose defaults equal current production behaviour: `GRIDEX_PORTAL_IDENTITY_ENFORCEMENT=report`, `GRIDEX_INVOICE_DELIVERY_RESOLVER=legacy`.
  - Never flip these flags without a separate explicit decision from the user.

## Merged to main this session
- **#427:** next 16.3.8, nodemailer 10, imapflow 2, ip-address 10.7.2 (security). `ecc19a2`.
- **#428:** F16, support cases no longer trigger operational stops. `3a1d351`. Read-only check: `gridex-ops-dev` had 0 affected support cases. The production DB is not reachable from this session.

## Open PRs
- None besides #425. **#429 merged** (`a94557c`, Ediel native run-relative calendar); main merged into #425 at `4cd6d74`.

## Done on #425 (verified locally: vitest 396 files / 6303 tests, typecheck, lint, api:docs, build)
| Item | Commit(s) |
|---|---|
| P0 inventory | `6fddd8a` |
| P1a read-only resolver + binding (behind flag) | `6fddd8a`, `b2caf84` |
| P1b no reactivation / F5 | `a4dbb0a` |
| P2a shared contact rules | `140387a` |
| P3 shared invoice delivery (behind flag) | `75132a1`, `b2caf84` |
| P4a support conversation | `17a56ea` |
| P5a navigation + case view | `b146cb7` |
| tenantDb | `9a2f98d` |
| P6 contract 2026-10-01.1 | `0223b9f` |
| P5b customer card header/groups | `0267af5` |
| P6 reference client | `b08fdb9` |
| F9 unique idempotency migration | `19b9251` |
| P7/P8 docs | `d2e45b9` |
| P2b migration `20261001210000_customer_contact_change_transaction.sql` (RPC `gridex_customer_contact_change_v1`; repairs `customers.invoice_email` replay drift; staff authorized via `gridex_actor_has_company_permission(...,'masterdata.write')`) | `19b8c7f`, `5a708ce`, `71c56c7` |
| P2b adapters: OPS `profile-actions.part-1.ts` + API `profile-update/route.ts` call `lib/customer-service/contactChangeTransaction.ts` | `fc1e60e` + types commit |

## Next actions (in order)
1. Types regenerated from clean replay artifact (sha f256db9b…) and committed with adapters. Wait for #425 CI fully green.
2. Behaviour note: OPS profile save now requires `masterdata.write` in the DB (before: only operate-company; UI already hid the edit for others). Audit rows now hold only changed fields.
3. **P1c:** needs a user decision (tenant identity provider). Open item.
4. When everything is green: mark #425 ready, squash-merge, verify the Vercel production deploy of the merge SHA.

## Do not touch
- #310.
- Ediel branches and the Ediel memory files.
- Production data.
- The rollout flags.

## Lesson (2026-10-01)
- A migration that changes schema needs BOTH generated files from the CI clean-replay artifact: `supabase/database.types.ts` (+ sha in `scripts/supabase-types-manifest.json`) AND `supabase/schema.sql` + `supabase/schema.fingerprint.json` (from `rem002-schema-snapshot/`). Pushed `763aae2`. Never hand-edit either.

## After merge (2026-10-01 ~21:00 UTC)
- #425 squash-merged as `d548e23`; Vercel production deploy run 36925343909 started.
- **Migrations are NOT applied by the deploy.** Production DB has neither `20261001200000` nor `20261001210000` until someone applies them with explicit user permission.
- Follow-up PR: `applyCustomerContactChange` falls back to the previous sequential path when the RPC is missing (PGRST202/42883), so OPS/API profile saves keep working before the migration. Remove the fallback once all environments have the migration.
- Next: user decision on applying migrations to production; P1c needs an identity-provider decision.

## Production migration status (2026-10-01 ~21:15 UTC)
- #430 merged (`8f4c33c`): RPC-missing fallback is live, profile saves are safe without the migration.
- User said "kör det" to applying migrations. NOT applied, because:
  - Production Supabase project is not identifiable (Vercel `NEXT_PUBLIC_SUPABASE_URL` is a sensitive env; not decrypted).
  - `gridex-ops-dev` (only full-schema project) is at `20260904222450`; main has many later migrations (e.g. Ediel 2026-09-23/24). Applying 20261001200000/20261001210000 would skip them out of order.
- Needed from user: which project is production, and whether the whole pending migration backlog should be applied in order (coordinate with the Ediel track).
