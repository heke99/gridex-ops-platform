# Independent bounded SQL review — E035 canonical register facet

Verdict: APPROVE static design/code for this bounded facet, conditional on successful native replay and actual-head regression gates. No confirmed blocking security or correctness finding. This is not whole-PR approval, source approval, legal/business approval, or completion of E035.

## Scope and evidence

Reviewed baseline commit 92d4980 and existing migration 20260922095911_ediel_received_source_ledger.sql; new migration 20260922131136_ediel_received_register_validation.sql; scripts/ediel-register-validation-regression.sql; receivedRegisterValidationBinding.ts; prodatRegisterValidationEvidence.ts; receivedSourceValidationEvidence.ts. Read AGENTS and required task/domain memory. Repository modifications were inspected but not edited.

Skill routing: using-superpowers explicitly exempts dispatched subagents. Applied code-review, differential-review, Supabase, and Postgres guidance; fp-check informed rejection of the suspected null/provenance/duplicate bypasses below. Broad repository inventory/scanner/supply-chain/performance/UI/refactoring/remediation workflows are outside this assigned read-only SQL subreview. No package or dependency change, UI, deployment, hook installation, production operation, or remediation was performed. Parent retains broader audit gates and memory ownership.

## Findings and bounded conclusions

No confirmed defects requiring SQL correction.

1. **NULL/shape boundary holds by inspection.** Facet, objects and occurrences have object-type checks and required-key sets, with unknown-key rejection. Nullable identities and wire fields require actual JSON null or bounded strings. Non-null numeric positions require JSON numbers, bounded integer syntax and casts only after validation. Missing numeric fields, explicit null, numeric strings and fractions cannot reach insertion. The later ordinary `<>` checks operate on values already type checked; this is not the historical missing-key SQL-null bypass.
2. **Occurrence identity remains strict.** The duplicate object key includes message index, object identity and agency; identity-less objects include their first physical line. Register positions start at one and are contiguous inside each object. Segment indices increase within each object. Physical line and segment indices are unique across all objects. Duplicate semantic register wire values are intentionally not prohibited: rejected register evidence must remain representable, and physical occurrences are the uniqueness boundary.
3. **Tenant/hash boundary is unchanged.** Source selection binds source ID, company and environment and locks the source row before reading the predecessor. Input payload hash must be identical to the persisted original. SQL stores the selected source hash and scoped company/environment. Fresh application evidence additionally checks original/validated row identity and exact raw payload against the captured context.
4. **Rule evidence is required for the facet.** A non-null registry tuple must identify a profile joined to its actual pack with matching profile key, pack ID and source hash. This is trusted service-produced observation provenance, not proof that SQL executed the canonical validator. SQL does not parse EDIFACT, check every wire reference, or establish that a registry tuple was the selected runtime policy; the fresh owner and TypeScript binder carry that contract. Treating these omissions as an unprivileged injection finding would be a false positive under the assigned trust model.
5. **Approval injection stays closed.** Owner and coverage literals are fixed, sourceDisposition remains not_established, objectDisposition and partyDisposition remain not_checked, and unknown keys fail. A register accepted disposition cannot set full source, legal-party or business acceptance. The return receipt remains not_established.
6. **Immutable predecessor and permissions are preserved.** Exact function diff changes only CREATE OR REPLACE, local variables, the extra allowed top-level key and optional facet validation. Source locking, predecessor selection, facts hash and insert/receipt code are retained. No table, trigger, RLS, grant, public facade or signature is replaced. Existing immutable triggers, unique first/predecessor indexes and service-only facade remain applicable. Replacing the same function identity retains existing ACLs; native ACL/replay gates must confirm the delivered migration.
7. **Resource bounds remain finite.** Existing 65,536-byte facts cap still applies before JSON parsing. Facet/object/register/reason counts and token lengths are limited. Linear-array membership checks are quadratic in occurrence count but bounded by the much smaller serialized byte cap; no new material performance defect was established.

## Nonblocking regression recommendation

The new script exercises missing fields, several malformed types, duplicate object/line/segment, accepted/rejected/unavailable, legacy callers, foreign company, absent rule evidence and approval injection. It does not exhaustively cover explicit null or wrong-container values at each structural layer.

Recommended addition (not a code-blocking defect): table-drive JSON null, boolean, array and scalar facet/object/occurrence values, null numeric indices, duplicate reason strings, noncontiguous positions, descending segments and extra nested keys. Have negative cases assert the expected SQLSTATE/error family, not only that some check violation occurred. Add a positive multi-register object and two null-identity objects with distinct physical lines. Retain existing ledger ACL, wrong-hash, environment and predecessor-chain tests when running native gates.

## Verification and limits

- Read-only git status/log and implementation inspection: completed; baseline HEAD 92d4980.
- Programmatic unified diff of old/new append_validation bodies: completed; confirms bounded change described above.
- Regression SQL review: completed, not executed by this reviewer.
- Local psql/docker discovery: neither executable available in this workspace.
- Native preparation, migration replay, role/ACL assertions, concurrent append and SQL test execution: pending parent-owned disposable environment. No native success claim is made here.
- No hosted/live operation or production-code edit performed.

Approval is limited to the reviewed SQL design and contract. Successful native gates are still required before delivery qualification; broader per-object/source/accepted-tenant/legal-party/business owners and E035 remain explicitly incomplete.
