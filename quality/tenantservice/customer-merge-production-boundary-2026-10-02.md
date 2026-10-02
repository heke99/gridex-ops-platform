# OPS customer merge: production deployment boundary

This is a read-only pre-activation receipt. No production DDL or business mutation was performed. The frozen PR458 candidate is head `b08c77e60f4bc0a1c42de2e10ad3fb984b1a808d`, tree `388ab34a9f5447d6217ae574f99bc7891aaf7c7d`, integrating actual main `472d703e7580fdaa49374f4d7aa202da74751057`. All applicable final-head CI workflows passed; crawler is intentionally skipped. Independent SQL/source review passed 53 additional tests. Subsequent error-boundary review found exact lifecycle-guard errors escaping the exported resolver/context result and producing generic 500 responses in the two website event routes and the website application stage. The accompanying bounded application correction must pass fresh exact-head CI before merge; b08 alone is superseded as the release candidate.

## Actual project and live predecessor

OPS Supabase account link `link_6aa08570afb48191a4eb728ab8e93c81` (Supabase), project `piidsfebjqjmnepdpnas` / `gridex-ops-dev`, ACTIVE_HEALTHY, eu-north-1, PostgreSQL17.6.1.084. Tenantservice memory records this named dev project as user-confirmed production. Dashboard: https://supabase.com/dashboard/project/piidsfebjqjmnepdpnas . Use this exact link/project, never the gridex-web link/project. Root separately verified OPS Vercel production `dpl_7Wo7qw819H3Acsu2qqHcBCJdfLU3`, READY at main472d703e with aliasapp.gridex.se.

Live ledger count366. It uses MCP apply timestamps rather than repository file versions; compare names and verified object effects, not just absent file timestamps. The existing customer merge RPC has the same arguments and normalized executable body as repository222000; live comments were removed. Normalized MD5 is `d1ec97bdab542f13be079611a32c9fbb` on both. The contact RPC source is byte-identical to prior210000 (`787f634401d593b7819a01d06aeef67a`). Both expose EXECUTE only to service_role, with merge SECURITY DEFINER and contact SECURITY INVOKER. The unchanged signed-owner trigger source matches canonical `e37e13a157f91f401e526b53d5eefdc1`.

## Pending file and prerequisites

Only this candidate migration is pending among the inspected Oct2 tenantservice lineage: `supabase/migrations/20261002230000_customer_merge_portal_lifecycle.sql`, SHA-256 `836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9`. The merged-customer guard function and its13 triggers are absent in production.

The direct prerequisites are already applied:

| Repository filename | Live ledger name/version | Purpose |
| --- | --- | --- |
| `20261001210000_customer_contact_change_transaction.sql` | customer_contact_change_transaction /20261002065320 | Existing contact RPC signature/body replaced |
| `20261002100000_support_case_attachments.sql` | support_case_attachments /20261002092737 | Attachment graph and owner FK |
| `20261002210000_tenant_company_foreign_keys.sql` | tenant_company_foreign_keys /20261002164619 | Named composite owner constraints |
| `20261002222000_customer_merge_atomic.sql` | customer_merge_atomic /20261002180105 | Existing merge RPC signature/body replaced |

Live ledger names also confirm prior identity providers, identity requests/billing revisions, invoice provider/file export, archive/test delete, lifecycle/supply/anonymization/supplier decisions, data request/POA, billing import/invoice purchase, portal claim, invoice approval/review/period lock. Their ordered repository filenames are included in the code and the exact observed live versions are preserved in the accompanying JSON receipt. No predecessor needs reapplication. Do not run db push, rewrite the compact ledger, or call migration repair.

All14 FKs named by230000 exist, are validated, nondeferrable and initially immediate before the patch. Required customer columns and `gridex_actor_has_company_permission(uuid,uuid,text)` exist. Optional dynamic graph tablecustomer_profiles is absent; both table loops explicitly skip absent optional tables. No mandatory relation/constraint/helper prerequisite is missing in the inspected graph. Aggregate portal identity/account/tenant-link counts on merged source customers are allzero; no customer IDs or personal data were queried or recorded.

The live ledger also contains `20261002227000_converge_grid_owner_agreements_email_domains_quality_view`, absent in the frozen repository, with NULL statements. Its full body/provenance cannot be certified from the ledger. This receipt makes no whole-production-schema parity claim. The specific objects overwritten/required by230000 were independently verified against the expected prior schema; the patch does not referencegrid_owner_agreements, email_domains or a quality view.

## Application and DDL order

230000 changes no existing table columns, RPC parameter lists or return type. It replaces merge/contact bodies, makes only14 named FKs DEFERRABLE INITIALLY IMMEDIATE, and installs a merged-source write guard. It deletes/deduplicates no production rows, rewrites no identities or historical attachments and retains signed-contract immutability. Its transactional merge still checks final ownership constraints before success. Concurrent customer/support/profile writes will acquire customer locks or receive a controlled conflict; DDL can wait for existing transactions and should run at a coordinated boundary.

New application code can start against the old schema and RPC signatures, but old merge/contact bodies and missing triggers do not provide the new stale-write race guarantees. Root chose application first: merge only the qualified corrected app head, verify the exact production deployment READY and alias, then apply this single reviewed migration to the verified OPS project. No extra user permission boundary is inferred here; this is the technical release order.

Independent PostgreSQL 17.6 tests distinguish the operations precisely:

- Actual active identity INSERT ... ON CONFLICT first runs the BEFORE INSERT guard, waits for the parent SHARE lock held by an ordinary contact transaction, then succeeds after its commit. A new ordinary-contact UPSERT failure is disproved.
- A direct owner-column UPDATE already owns the child tuple. The conservative SHARE NOWAIT guard can reject a same-owner active update while another transaction holds the parent UPDATE lock; retry succeeds after commit. It is a controlled conflict and is not limited to already-merged customers.
- Case-status transaction versus merge can deadlock with SQLSTATE 40P01, with atomic rollback. The exact same interleaving deadlocks in the old baseline through its existing FK KEY SHARE check. This is a pre-existing concurrency limitation, not an introduced migration blocker; no whole application zero-conflict claim is made.

The correction maps only SQLSTATE 23514 plus exact message customer_merged_write_conflict at the new shared boundaries, preserving unrelated constraint and permission behavior. It keeps existing response envelopes and changes no published schema bytes:

| Application boundary | Controlled result |
| --- | --- |
| Exported portal resolver and both real context factories during explicit link | Existing resolution error / 409 portal_identity_customer_conflict |
| Shared portal idempotency claim and executed customer writes (including partner compatibility handlers) | Existing ApiInputError / 409 portal_identity_customer_conflict |
| POST /api/v1/events and /api/v1/website/customer-events, including post-event support creation | Existing canonical event error envelope / 409 portal_identity_customer_conflict |
| Website application staged identity/link and cached-source resume | Existing WebsiteApplicationError response / 409 portal_identity_customer_conflict |
| Existing end-customer support/read/write handlers | Raw guard preserved by domain wrappers and existing shared route mapper / 409 |
| Existing profile/contact adapter | Version-conflict result / profile 409 |

Mounted customer/sync already called its link context inside a route try; outside-try customer/support contexts are read-only and never invoke the mutating link helper. The resolver/context regression proves the exported result boundary and is not evidence that a shipped sync route previously returned 500. The multi-statement website/link/event helpers are not claimed to be one transaction; failed SQL statements and the merge/contact RPCs retain transactional rollback. Existing preceding idempotent application writes and their recovery rules remain unchanged.

After controlled file application, root verifies the ledger entry, exact RPC/guard source hashes, ACL/security/search paths, all 14 FK topologies and deferral modes, 13 trigger bindings and unchanged signed guard using the accompanying read-only assertions. No synthetic production fixtures are needed. If DDL is held, the lifecycle release remains partial; .4/Web publication is independent.

## Native and final CI evidence

Bounded local PG16 graph proof covered real canonical FKs/legal/state guards and two-session races. The complete final-head Supabase replay job111026217718 in OPS run37063712963 passed migrations, lifecycle/concurrency,382 native ownership tests, case native/browser/recheck, type generation, tenant invariants, injected drift selftests and final schema comparison. Final artifact11251911802 ZIP SHA-256 `5b0ed839a2e0ecf6701134fbf47bcea284de5c8d1ac06594cd02024876bc4eea`; actual CI checkout 12a5b560cfff7bde041587f09b64402de6cdb25f has tree 388ab34a9f5447d6217ae574f99bc7891aaf7c7d exactly matching b08. Generated types SHA58bcc698… and canonical schema fingerprint e1703980… remain identical. This authentic local replay is not a production write simulation.


## New-main composition before publication

Actual main became889a2378411f826026336a593e3fde1ba8ba7258 (PR463) and root verified production READY deploymentdpl_9hPQwbGu8unuE24M5QXxpZTjcg8Q. Its227000 file is now present in the composition; the earlier absent-repository statement describes the b08 snapshot. Live ledger SQL for that entry remains NULL, so its full live executable provenance is not independently reconstructed here. Root reran the frozen preflight: every affected target catalog field still matches the before JSON exactly. The230000 source file and frozen pre/post assertions are unchanged.

The final app correction now preserves current main's new table/view/type additions. Canonical fingerprint e1703980… is historical; latest-main authentic baseline8cfd07b3… is also only a baseline for the combined230000 replay. Real combined capture is pending and will be imported from its exact CI artifact; no full combined-schema parity is claimed before that successful replay/import/final CI sequence.

## Authentic combined capture imported; final CI pending

The preceding capture-pending status is superseded by genuine artifact11254046371 from OPS37068613316/job111042463333. Its PR head is `53080e7d74b5a44e275c8aed7eb19a506a290084`; actual CI checkout `a6a085ee440ee90c53c7bff65d57f2536b5278fa` has the identical tree `332590e25bf9058b39d24280c6cbc7912e9c14b7`. ZIP SHA256 is `16daef10057ba44aef6a491879a70df4574be2fd3cf256311b891a8bdae5ec15`.

Native capture passes lifecycle/concurrency,382 ownership tests, native case/browser/recheck, type generation, tenant invariants and all injected drift classes. It fails only the intended final comparison with the historical main baseline8cfd07b3. The actual combined fingerprint `cc62d4a7c0c099fe0cac3dff838388f59c605f82639c0d55f8381a7ba0765da7` and schema.sql SHA256 `c172f3458e522e50f75fb55a91e8fa7a6b1de6f619a3586708178f0ee5d000fb` are imported byte-for-byte, alongside unchanged type bytes272c9783. This capture run is qualified evidence of generation, not an all-green final schema gate.

New actual main `79d03223a33ecd400ee7440b8f6d579e9a8ea25a` (PR464) is preserved. Its UI/history changes have no SQL/schema/type-generator/replay input delta, so they do not invalidate this schema capture. Fresh composed83 focused/UI tests and application TypeScript pass. The frozen230000/preflight/snapshot/postassertion files and immutable .2/.3/.4 bytes remain unchanged.

**All applicable exact new-head CI gates remain pending after this import publication.** Root must qualify that final head and its production READY/alias before the single controlled migration and postapply assertions. Reviews and review threads are empty; the draft bot skip notice is informational. Independent source/SQL review has no unresolved material finding. No production migration or business fixture was run.

The last pre-publication ref check found newer main `276b9e6155ef2cd83b5d75a61283fc4d99d9f184` (PR465 navigation/Swedish wording). Its complete UI/history delta is also preserved without conflict. Database/replay and affected API inputs are unchanged; genuine53080 capture remains valid. Final exact-head CI and production application/DDL gates remain pending.
