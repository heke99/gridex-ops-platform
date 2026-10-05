# TR-06 certificate ownership and exact validity

Owner: Codex chat `01a1084e-26ac-72b5-84ee-ed57bf62d040`.
Branch: `codex/ediel-tr06-certificate-20261004`; initial base `cbefde67712a7ad4e018abf688d1d2e242a61faf`.
Preparation follow-up: `codex/ediel-recipient-preparation-20261004`, based on #506 head `bfd5bc8e`.
Readiness follow-up: `codex/ediel-recipient-readiness-20261004`, based on #510 head `d865f7ad`.
Main integration `33aeb7f7` retains the existing TR-01/02 source, tests and coverage rows;
the only conflict was the crypto test header, resolved by preserving both ID tags and lifecycle imports.
Coordination: https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5983511741
Status: VERIFIED_CODE_SCOPE (TR-06, AT-TR-06, SC-060 approved; GitHub merge gates pending).

## Scope and ownership

TR-06, AT-TR-06 and SC-060 only. Existing TEN/P/U, ENV/GOV and TR-01..05 owners retain their files.
GOV-07 was already approved on main: reservation released without changes or repeated work.
Shared campaign checkpoints are owned by the existing integrator; this packet never overwrites them.

## Confirmed defect and repair

The actual resolver accepted another tenant's certificate row and unowned
`tenant_owned`/`route_specific` rows in both explicit-ID and automatic selection.
The protected authority still pinned the correct public receiver fingerprint;
the reproduced impact was foreign row/raw attribution, not an unauthorized
cryptographic recipient. The query could also let foreign duplicates consume
candidate limits or create ambiguity. Admin certificate import explicitly
supports `company_id=NULL, scope=platform_shared`; that behavior is preserved.

Early company UUID/environment validation now precedes reads. All three public
certificate reads select the own company or explicitly shared platform rows.
The shared runtime scope guard and required-set matching also enforce ownership.
Route-profile rereads require the own company. No SQL/schema/transport files changed.

## Executed evidence

- Node 22.23.3 baseline: 42/42 certificate tests PASS.
- Unmodified resolver with new behavioural tests: 6 FAIL / 77 PASS; independent reviewer reproduced the same failures.
- Corrected scope/crypto/validity plus retained CMS and previous-CRL exception suites: 151/151 PASS in 6 files, including required-set protection against foreign duplicates from a mis-scoped read.
- Real signed synthetic CA/recipient leaves, CRLs and signing-only X509 certificate;
  actual OpenSSL PKIX/purpose/revocation checks. Only database reads are substituted.
- Covers exact row and PEM validity instants, lifecycle/security status, receiver,
  subaddress, family/code/environment/tenant, direct ID versus candidates,
  immutable records, source authority expiry/scope/fingerprint, missing chain,
  absent/revoked/stale signed CRL, foreign duplicate, own/foreign route profiles,
  preserved platform sharing and invalid tenant input.
- App/tests/scripts typechecks, owned lint, tagged-approval check (352 IDs, no tagged failures),
  spec integrity (33 originals/121 rules/231 contracts), service-role ratchet and diff whitespace checks PASS.
- Independent full-criterion review APPROVE; independent 139/139 targeted tests PASS.
- Integrated full suite: 9950/9953 PASS without concurrent typechecking; the same
  three UTILTS projection tests hit their 5-second timeouts on unmodified main
  `33aeb7f7` (9864/9867 PASS) and in an isolated network-enabled run. They pass
  3/3 when placeholder Supabase I/O is rejected immediately by the sandbox.
  The fixture omits the issuer/periodic-reason read ports invoked by the real
  runtime. The initial CPU hypothesis is disproved. ENV-01/#504 owns the fixture
  repair; this packet neither duplicates it nor weakens timeouts/assertions.
  Final run with the existing CI preload `unit-loopback-network-boundary.cjs`
  passes 9953/9953 on #506's code tree; real loopback tests remain enabled.
  GitHub gates on current #506 head `bfd5bc8e` remain the merge condition.

Synthetic source registration proves guarded code behavior and cryptography;
it does not prove a live issuer registration, database RLS or market activation.

## Separate observed caller gap

Existing `testing/testRunTransportMetadata.ts` and system-test certificate setup
omitted `companyId` despite the resolver already requiring it; metadata also
omitted its computed business code. The separate preparation packet adds exactly
five context lines at the four actual calls. Actual SMTP send already supplies
`message.company_id`. Route readiness additionally selects weakly matched rows
before/after the resolver. Its separate verified repair now calls only the
authoritative resolver with tenant/route/subaddress/family/code/environment;
blocked trust withdraws cached approval. No unscoped certificate reload remains.

Preparation evidence: four positive paths RED on unchanged callers; companyId
alone gives 3 PASS/1 metadata RED (`message_code_mismatch`); businessCode completes
the fourth positive. New 14-case suite uses real signed CA/leaf/clean+revoked CRLs,
resolver, AGT gate and run persistence; only Supabase/Expisoft ports are substituted.
Explicit/local/directory success and revoked/foreign rejection are covered.
Actual passive AGT L2/Z04 stores the own company and true leaf fingerprint;
foreign/code/authority/revocation failures precede locks, snapshots and run writes.
Implementer 142/142 PASS; parent review 165/165 in seven security suites PASS;
owned lint and application/test typechecks PASS. No new rule promotion or SQL changes.

Readiness evidence: unchanged engine 14 FAIL/2 positive PASS; repaired guard
passes those 16 cases. Two further forged stored-fingerprint probes reproduce
RED; verified PEM fingerprint overlay repairs them without changing the source
certificate row. Readiness18 + retained preparation14 =32/32 PASS; parent review
199/199 in nine security suites PASS, both updated architecture scripts32/32,
owned TypeScript lint and app/tests typechecks PASS. Shared synthetic fixture
generation removes duplication without committing keys. Integrated full suite
with the existing CI network preload is pending; no whole-suite claim yet.
ACK-01 review support on Claude's exact #491 head `e07e5937`: owner test4/4 PASS,
APPROVE for ACK-01/AT-ACK-01; SC-041 remains unexecuted. No duplicate ACK packet.

## Next action

Inspect exact-head GitHub CI and merge #506 when all applicable gates are green.
ENV-01 owns the inherited UTILTS fixture fix. The separately reserved preparation
packet covers only the system-test helper and transport metadata callers with
genuine positive/negative behavior tests; publish against #506's branch, retarget
to main after #506 merges, and merge only after its own exact-head gates pass.
Publish the now verified readiness repair against #510 for a small separate diff,
retarget after that parent merges, then require its own current-head CI. No
ENV/P/U/worker overlap or extra card promotion. Record one handover line per merge.

Skill routing: using-superpowers/executing-plans/using-git-worktrees for isolated
continuation; spec-to-code-compliance + independent read-only reviewer for the
literal card; test-driven-development/systematic-debugging/fp-check for the
reproduced tenant defect; Supabase for the protected read boundary;
verification-before-completion/requesting-code-review for approval. No schema
change, UI/performance work, new dependency, hook or skill authoring is in scope.
