# TR-06 certificate ownership and exact validity

Owner: Codex chat `01a1084e-26ac-72b5-84ee-ed57bf62d040`.
Branch: `codex/ediel-tr06-certificate-20261004`; initial base `cbefde67712a7ad4e018abf688d1d2e242a61faf`.
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
  No full-green claim; exact-head GitHub coverage/smoke/browser-public are green.

Synthetic source registration proves guarded code behavior and cryptography;
it does not prove a live issuer registration, database RLS or market activation.

## Separate observed caller gap

Existing `testing/testRunTransportMetadata.ts` and system-test certificate setup
omit `companyId` despite the resolver already requiring it; metadata also omits
its computed business code. A separate reserved preparation packet will repair
these positive flows with actual-resolver tests. Actual SMTP send supplies
`message.company_id`. Route readiness additionally selects weakly matched rows
before/after the resolver and can approve untrusted material; that distinct
defect requires its own ownership check and behavioral proof before repair.

## Next action

Inspect exact-head GitHub CI and merge #506 when all applicable gates are green.
ENV-01 owns the inherited UTILTS fixture fix. The separately reserved preparation
packet covers only the system-test helper and transport metadata callers with
genuine positive/negative behavior tests; no readiness/ENV/P/U/worker overlap.

Skill routing: using-superpowers/executing-plans/using-git-worktrees for isolated
continuation; spec-to-code-compliance + independent read-only reviewer for the
literal card; test-driven-development/systematic-debugging/fp-check for the
reproduced tenant defect; Supabase for the protected read boundary;
verification-before-completion/requesting-code-review for approval. No schema
change, UI/performance work, new dependency, hook or skill authoring is in scope.
