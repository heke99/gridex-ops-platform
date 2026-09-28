# Contact writer trace — P2 continuation

## Authority and verified boundary

The exact published PR head `3af25a7aa106f1d2038a2b759d26695e43ec9d43`
passed OPS run `36482130912`, clean job `109130083546`, including
`P2_CONTACT_BROWSER_API_NATIVE_PASS`. This covered the primary-contact form
on the OPS customer card and delegated contact-only API, using synthetic
tenants, customers, Auth users and issuer. It did not cover other writers or
a real issuer. T44, T49 and U18 remain PARTIAL in `requirements.csv`.

## Source trace

| Writer | Source | Current scope |
| --- | --- | --- |
| OPS customer-card primary contact | `components/admin/customers/CustomerContactsAddressesCard.tsx` → `lib/customer-operations/contactCommand.ts` → `gridex_change_customer_contact_v1` | Verified on the above head, including browser and native post-read. |
| Delegated customer API contact-only update | `app/api/v1/customer/profile-update/route.ts` → same command | Verified on the above synthetic head; real issuer missing. |
| OPS customer-card secondary contact | Same card had a direct service-role `customer_contacts` insert/update followed by `audit_logs` insert. It ignored `expected_revision`. | RED: the new stale-revision test resolved instead of rejecting and wrote both rows. The candidate routes this path through the same locked command with a distinct secondary target, customer revision, idempotency, canonical audit and secondary domain/outbox topic. Native and browser replay are pending on a new SHA. |
| OPS customer profile | `app/admin/customers/[id]/profile-actions.part-1.ts` updates legal/name/lifecycle fields independently of the contact command. | Contact email/phone were removed from this action earlier; remaining fields require separate policy, revision and atomicity work. |
| Tenant-machine sync | `app/api/v1/customer/sync` blocks direct phone change before lookup/claim. | Fail-closed for phone; full sync and authorized machine contact semantics remain open. |
| Customer onboarding | `app/admin/customers/actions.part-2.ts` passes the initial primary contact into the existing onboarding transaction. | Separate creation semantics, revision/event reconciliation not yet proven. |
| Duplicate merge and erase | `app/admin/customers/duplicates/actions.ts` transfers associated contacts; `app/admin/customers/[id]/profile-actions.part-2.ts` deletes them during erasure. | Both need independent transition/retention review; the contact-change command does not model these operations. |
| Synthetic Ediel test/customer fixture | `lib/ediel/portalTestCustomer.ts` inserts a billing contact under explicit test flow. | Not part of live OPS contact editing; its contact effects and cleanup require separate review. |

## Candidate boundary and verification

The secondary path is OPS-only. It rejects a primary row as a secondary target,
rejects a stale displayed revision, locks the customer and selected secondary
row, and leaves the customer's primary email/phone unchanged. Existing primary
request hashes remain byte-identical because `contactTarget` and `contactType`
are added to the canonical request only for secondary writes. API callers
cannot request this target. The SQL fixture checks stale revision, primary
target denial, API denial, create/update/replay, audit fault rollback and
primary-field preservation. The browser fixture adds a secondary contact after
the already verified primary/API steps and the native after-read checks its
revision, event and outbox. No new native/browser result is claimed yet.

Skill routing: repository `using-git-worktrees` protects the nine unrelated
dirty billing/evidence files; `test-driven-development` and
`systematic-debugging` govern the RED-to-fix sequence; `supabase` and
`supabase-postgres-best-practices` apply to the invoker RPC, tenant scope and
row locks; `verification-before-completion` and `scan-secrets` apply before
publication. Delegation skills are skipped because this is one serialized
writer path and the user asked for one active author. Broad performance/UI
audits and skill creation are outside this bounded change.
