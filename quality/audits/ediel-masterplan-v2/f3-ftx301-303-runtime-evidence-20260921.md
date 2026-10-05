# FTX301/303 bounded runtime candidate — not accepted yet

Source: original P26.A r3 qualified in independent5752810321 (SHA25683c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95). Design/oracle5752868541 and required reader clarification5752898014 preceded remediation. The clarification fixes exact header-AAI/own-first-register-ACB scope, decoded five-by-70 C108 values, raw preservation, source-selected usage and local outbound diagnostics only. Prior qualification document is a historical pre-implementation snapshot, superseded here for progress, not for source authority.

## Exact source and meaningful RED

Source archive10613927369/run35539362205 binds8706af34 and tree0aba8a9b2ac4443bed25b4f23dfd043c1a29dc88. ZIP78d1d01f1270345bca7798a7df85f4f76047839f994f9a915a33925902897faf and TAR2ff552d918ee1d571f3fc721b3cb0582f4eb070f0636aeb27a68fabdc6fe864f were recomputed; reconstructed Git index matched the exact tree. Runtime remained unchanged in21fb0402 and19ab3894, which publish the native and actual SMTP RED tests. Reconstructed19ab tree9908bf04a116ecf5a8a27108ee94e5e74bdcc251 also matches GitHub exactly.

Initial setup mistakes in outbound address evidence/expected AAO syntax were corrected before the durable RED. The203-case script published21fb included one malformed second-UNA fixture: its tokenizer exception is NOT behavioral RED. That test was corrected to two UNH messages in one interchange. The same corrected205-case oracle was then rerun on untouched baseline:70pass/135fail, and local fix205pass. Later43 direct boundary cases extend the final native oracle to248; on the untouched baseline85pass/163fail, and on the candidate248pass/0fail/0skip/cancel/todo. A baseline registry external-boundary attempt is a missing pre-I/O hold, not a mocked policy result; all candidate external effects are absent. All imports/setup complete.

Actual ordinary CI on19ab independently confirms SMTP RED: OPS35540019522 job106155869685 executes all10 tests, all fail because expected PRODAT_FTX_ is absent and the existing route/context path reaches UNEXPECTED_DATABASE_BOUNDARY. Other4969 unit/integration tests pass. This is before adding the SMTP entrypoint text hold; not an import or invented runner failure.

## Confirmed defects and bounded implementation

1. Wrong/header/object/unknown FTX qualifier and released separator handling can manufacture301 or303 presence. One release-aware reader now selects the actual first PRODAT message, header AAI before SG4, and own SG8 ACB before measurements/parties. Existing register grouping remains authoritative; later common text is never borrowed, and incoming raw remains unchanged.
2. Extra unused incoming303 causes an actual typed42/303 negative P-APERAK (or internal review with empty text). Incoming base business validation excludes these optional/gray text fields; actual runtime decision plus actual P-APERAK positive controls now pass, while independent required322 still produces41/322. Z09 is a differential-retained-issues control, not an all-valid positive message claim.
3. Malformed or locally forbidden outgoing text passes preflight/rulebook/send-lock boundaries, including intentional-invalid labels. The same reader supplies a PRODAT_FTX_SEND_CONFORMANCE internal diagnostic and pure send hold before metadata fallbacks and registry I/O. Actual wire wins over row/format hints. SMTP checks it after actor validation but before context/route/provider I/O. No new national ERC mapping, no changes to optional text producers or frozen field usage, no raw rewriting, no database or security changes.

## Fresh verification scope

Local Node22.16.0 actual native suite:248/248. Prior native regressions in the final selected eight scripts:648/648 (UNB request, document fields, component escaping, reference fields, characteristic fields, source locators, guide governance and rule-pack identity). These are explicit selected suites, not an assertion about all74 fields. Source integrity check passes33originals/121rules/231contracts and expressly does not certify runtime. git diff --check passes. Real Vitest SMTP10 RED is recorded above; the candidate's12 SMTP tests including two route-boundary positive controls, ordinary native wrapper, lint/typecheck/build/fullCI have NOT been executed locally because node_modules is unavailable. Final ordinary CI must execute them on the published candidate.

Log SHA256:
- final baseline248:8eb81b1606f7f964369e37db2c40a0342bcb7ecac380c1e570feeddfad89aae4
- final localGREEN248:beea1cb1101e27e696b69ef95a62853bee4377910d7e1fd1f80806e2c96e3d90
- selected648regressions:39ba8918b8788232853acd52a56199cdbebe42a0feb1e91b10d03e25abb7f055

## Publication and remaining gates

Use the existing bounded temporary-publication pattern: exact19ab base, digest-pinned patch, exact expected tree and changed-path allowlist; run targeted genuine tests before non-forced work-branch publication. Temporary helper workflow/patch remain outside the candidate ancestry/tree. No permanent CI, acceptance threshold, source, schema or permissions change. Target only PR359 work branch, never main/PR310. Follow with ordinary exact-head CI and independent runtime/task/quality/tenant/whole-PR review; fix concrete findings, guarded merge and actual-main certificate/OPS before acceptance.

Accepted runtime remains PR358/main352fd8ee with its existing separate receipt. D110/110+10/10 unchanged. FullF3/masterplan NOT_COMPLETE, no new live or deployment approval. PR310 remains OPEN/DRAFT/PAUSED ate961135199f292b8210884f07de3b616a670161a.
