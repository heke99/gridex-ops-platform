# Task 3a bounded schema reconciliation review

**SPEC: PASS. QUALITY: PASS for this reconciliation only.** No new Critical/Important issue is established. Final same-head CI after publication remains pending before whole-Task3a acceptance. This review does not expand the earlier bounded native verdict into whole-branch approval.

Reviewed the supplied second replay artifact, copied canonical artifacts and the narrow wrapper/ACL delta against the published migration. Run metadata OPS35957199874/native107497927053 at published0a079a5b is parent-supplied; artifact contents/digests are independently verified here. No tests rerun, runtime edit, migration change or commit. Parent dirty documents are preserved.

## Artifact identity

- ZIP `/workspace/scratch/4b1d39503015/e035-pr372-outbound-schema.zip` independently hashes to `23e08764562a18d306c4bba1b4f84f2451a438e5e6dc23f77908f785b01fa9f6`. Every extracted member matches its ZIP bytes.
- Repeated generated types hash is `32ae2f06418bfb57bd3da0361f856bb544a360782967f33b962f9b9765518940`, identical to the preceding independently reviewed replay and checkout `supabase/database.types.ts`.
- Artifact/checkout `schema.sql` are byte-identical, SHA256 `ef41ebad7f037b1e227e00742d95cecc71bba26dbd4b4638cbb920ac9d9c23a2`.
- Artifact/checkout `schema.fingerprint.json` are byte-identical. Its canonical section fingerprint `.sha256` is `04ba0c99373f8ad4414c01ab73b3334280b9db63ac9604b88a531113be895ba4`, independently recomputed from sorted canonical section JSON. This is distinct from the JSON file-byte SHA256 `75c4e306970b7c5d6224f6063e35ae23be2a83506c0d185fe3351e4c2d33d0f5`.
- Published migration031626 remains SHA256 `8eff8a86530af7cb46fdb3cf5c650522f2b70db755c6561ab97ea211daa281a0`.

## Actual repeated execution and stop point

`rem002-clean-replay.log:18432–18433` records native301/5 PASS; `:18457–18458`, `:18766` and `:18773–18774` record case1/browser2/postbrowser1 PASS. `:18782` records repeated generated types32ae. `:18787` records tenant isolation invariants all checks passed. `:18793–18810` records identical-schema blocking comparison and all15 injected drift classes detected: missing/unexpected relation, type/nullability/default, unique/FK/index, RLS/policy/trigger, function body/grant, enum and view.

The snapshot is then actually generated (`:18812–18817`). The only terminal check failure shown is the stale committed snapshot/fingerprint (`:18822–18826`), naming functions617→618 and function_grants1616→1618. It is not a native/tenant/parity failure, and the overall job is not relabelled PASS. Copying the emitted snapshot resolves the evidenced stale-artifact delta, subject to the required final same-head rerun.

## Wrapper, ACL and scope qualification

The schema diff is exactly20 added lines for public `gridex_outbound_dispatch_v1(jsonb)` and its ACL. The body matches migration031626: jsonb input/output, plpgsql, `search_path=pg_catalog`, exact service_role current-user check with SQLSTATE42501, and delegation to `gridex_outbound_dispatch.mutate_v1(p_input)`. Migration explicitly specifies SECURITY INVOKER; pg_dump omits that default, preserving equivalent invoker semantics. Dump ACL revokes PUBLIC and grants ALL on the function to service_role (function ALL is EXECUTE). No anon/authenticated grant is introduced. The migration's explicit revocation from those roles need not appear as redundant absence in the normalized dump.

Only functions and function_grants section hashes/counts change, plus the resulting overall fingerprint. All other section entries are unchanged. This matches one new public wrapper and its effective function grants; it does not imply newly fingerprinted private dispatch tables/functions.

**Actual snapshot scope is `public` AND `gridex_received_sources`.** The artifact's `schemas` array expressly lists those two schemas; the canonical generator default at `scripts/gridex-schema-snapshot.cjs:157` agrees. It excludes `gridex_outbound_dispatch`. Thus the outbound reconciliation delta is public-wrapper coverage, not private-outbound-schema fingerprint coverage. Private owner behavior remains supported by the prior actual native qualification and unchanged published SQL hash, not by an absent fingerprint section. The parity selftest validates its enumerated drift-detection classes, not complete private outbound parity.

No policy, runtime behavior or private-schema coverage is inferred from this artifact update. The remaining acceptance gate is final same-head CI after the parent publishes these exact generated artifacts; the earlier minor formatting observation remains deferred to final whole-branch review.
