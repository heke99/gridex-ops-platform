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
| OPS customer-card secondary contact | Same card had a direct service-role `customer_contacts` insert/update followed by `audit_logs` insert. It ignored `expected_revision`. | RED: the new stale-revision test resolved instead of rejecting and wrote both rows. Candidate `0dcec790c79d4ef1fb05aec42ff24413b4621188` routes this path through the locked command. Its native fixture passed; the browser fixture saved revision 3 but raced the action refresh on immediate reload. Full clean replay remains pending on the follow-up. |
| OPS customer profile | `app/admin/customers/[id]/profile-actions.part-1.ts` updates legal/name/lifecycle fields independently of the contact command. | Contact email/phone were removed from this action earlier; remaining fields require separate policy, revision and atomicity work. |
| Delegated API noncontact profile | `app/api/v1/customer/profile-update/route.ts` → `updateCanonicalCustomerProfile` directly updates `customers` names, `invoice_email`, language and timezone metadata, then records completion separately. | Contact email/phone alone use the command. Other profile fields and completion do not share its revision/transaction; invoice email needs billing policy review. |
| Tenant-machine sync | `app/api/v1/customer/sync` blocks direct phone change before lookup/claim. | Fail-closed for phone; full sync and authorized machine contact semantics remain open. |
| Tenant-machine profile sync | `lib/customer-portal/tenantSync.ts` → `syncCustomerProfile` directly updates `customers` names, `invoice_email`, language and timezone metadata. | Separate from contact command and delegated API route; no shared revision/atomic audit is claimed. |
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
primary-field preservation. It reached `P2_CONTACT_NATIVE_PASS` on candidate
`0dcec790c79d4ef1fb05aec42ff24413b4621188` in OPS `36487682200`.
The browser fixture created revision 3, but its immediate reload raced the
Server Action's refreshed view; retries observed revision 3 through the API.
The follow-up waits for revision 3 before reloading. Native post-browser read
and full clean replay have not passed for secondary contacts. Artifact
`11000520569` supplied an authentic schema snapshot and fingerprint
`d18b1862bb276bcc22ed6568c34e549ccc144e91d19a6b7aa4210443a8a1fd9b`;
generated TypeScript matched committed bytes. This is candidate provenance,
not final-head parity.

Skill routing: repository `using-git-worktrees` protects the nine unrelated
dirty billing/evidence files; `test-driven-development` and
`systematic-debugging` govern the RED-to-fix sequence; `supabase` and
`supabase-postgres-best-practices` apply to the invoker RPC, tenant scope and
row locks; `verification-before-completion` and `scan-secrets` apply before
publication. Delegation skills are skipped because this is one serialized
writer path and the user asked for one active author. Broad performance/UI
audits and skill creation are outside this bounded change.
