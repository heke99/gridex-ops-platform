# Tenantservice side track: checkpoint

Status: IN_PROGRESS. Last updated 2026-10-01 ~20:30 UTC.

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
- **#429:** Ediel source-owner native suite runs in a run-relative calendar. Branch `claude/ediel-native-relative-dates`. It also updates the correction-context native expectation to F16.
  - Root cause: the fixed 2026-10-01 supply start vs the replay-time ledger epoch (see the comment on #426).
  - Merge when `clean-migration-replay` is green, then merge main into #425.

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

## Next actions (in order)
1. Wait for #429 green, merge it (squash), then merge main into #425 and push.
2. **P2b:** one DB transaction (SECURITY DEFINER RPC with server-derived actor) covering profile change, primary contact, audit and outbox.
   - Forward migration plus regenerated types. Types are generated from the CI clean replay artifact (`rem002-database.types.ts`); download it with `actions_get download_workflow_run_artifact`. Never edit types by hand.
3. **P1c:** independent end-customer proof. **Needs a user decision** on each tenant's identity provider. Keep as an open item unless the user decides.
4. When everything is green and done, mark #425 ready and squash-merge. Then verify the Vercel production deploy of the merge SHA.

## Do not touch
- #310.
- Ediel branches and the Ediel memory files.
- Production data.
- The rollout flags.
