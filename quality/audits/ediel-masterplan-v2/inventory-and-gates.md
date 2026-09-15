# Gridex OPS — Ediel v2 inventory and release boundary

Observed 2026-09-15 against repository head b9f732d28ceaf090e3b984e71d13a9cbd27f6408 (PR310), not only the old main revision cited in the uploaded document.

## Verified observations
- The supplied archive contains 33 manifest-listed files; every byte length and SHA256 matched before import. The manifest itself is preserved too.
- Existing lib/ediel contains 378 source files. Existing test filename inventory contains 49 Ediel/PRODAT/UTILTS/APERAK/DSN-related test files before this batch. Counts are discovery, not coverage.
- Baseline Node22 Vitest:212 files,2080 tests passed.
- GitHub PR310 remains draft/open/unmerged; latest observed head b9f732d2. Its native full replay/schema/real types/final E2E gates are not complete.
- Connected Supabase project gridex-ops-dev (piidsfebjqjmnepdpnas) was ACTIVE_HEALTHY. Read-only SQL observed279 migration ledger rows; latest version20260904222450. Ledger counts are not a one-to-one parity proof.
- All returned public tables matching Ediel/ESCO/permission/grant names had RLS enabled. This does not establish policy or service-role behavior.

## Existing ownership model
| Relation | Existing ownership/scope | Observed boundary |
| --- | --- | --- |
| ediel_message_intents | company_id, environment, market, sender/receiver, route/cert profile, customer/site, idempotency, expected rule/matrix version | reuse existing durable intent; no new parallel queue |
| tenant_ediel_profiles | company_id, environment, market, validity | no beneficiary assignment represented in inspected columns |
| metering_permissions | company/customer/site/metering point, grid owner, approval dates, purpose/product/direction, wire references | owner-scoped permission model; not accepted as three-layer provider/service/grant model |
| metering_permission_sites | company_id, parent permission, customer/site/object, validity, status | live parent FK is single metering_permission_id; full parent-tenant integrity still needs replay/schema/behavior evidence |
| energy_service_permissions | company/customer/object/DSO, lifecycle, effective interval, Z13/Z14/Z15/Z18 refs | existing lifecycle must be reconciled, not duplicated blindly |
| ediel_permission_cases | company/customer/site/object/DSO, permission ref and lifecycle | existing case model is not an internal beneficiary grant |

Observed live customer FKs for energy_service_permissions and ediel_permission_cases are composite (customer_id,company_id) ON UPDATE CASCADE ON DELETE SET NULL. Preserve PR310 source-backed decisions; do not mechanically replace with CASCADE.

## Findings and refutations
| Finding | Classification | Evidence |
| --- | --- | --- |
| Z14N required children despite inapplicable parents | confirmed; bounded repair | protocol.md and protocol tests |
| UTILTS_ERR APERAK selects P-family | confirmed; bounded ACK path repair verified | protocol.md and independent-protocol-review.md |
| UTILTS runtime/dispatcher chooses a different date/profile | confirmed; shared decision/date repair | context.md and decision-reuse tests |
| DSN original enters business parser and legacy diagnostic path | confirmed; quarantine repair | transport.md and DSN tests |
| SMTP ambiguous/post-acceptance error presented as failed | confirmed; typed uncertain outcome repair | transport.md and SMTP tests |
| Generic claim that route/certificate revalidation is absent | refuted | transport.md full path includes revalidation |
| Generic claim that missing company_id on protocol policy leaks data | refuted as stated | context.md distinguishes pure policy from tenant enforcement |
| Full provider/service/beneficiary grant model present | contradicted by inspected code/model | context.md; capability remains unimplemented/unaccepted |
| Field327/325 and other locator conflicts; flat per-register checks | open confirmed code/spec discrepancy | protocol.md; source reconciliation/golden cases required |
| Complete SMTP archive/DSN correlation and live route email binding | open | transport.md |

## Release gates
G01–G07 in the original package remain original source/evidence requests. None are closed merely by copying files or executing unit tests. In particular, older UTILTS full text, aggregate/test-scope materials, concrete cross-tenant mandates, historic SMTP/runtime binding and complete syntax/replay evidence are not replaced with inferred values.

Current changes can be reviewed in a stacked PR. Whole main merge remains dependent on PR310 and all relevant final release checks. No live database changes, external market messages, resends or production activation were performed in this batch.
