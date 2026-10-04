# TR-06 certificate ownership and exact validity

Owner: Codex chat `01a1084e-26ac-72b5-84ee-ed57bf62d040`.
Branch: `codex/ediel-tr06-certificate-20261004`; initial base `cbefde67712a7ad4e018abf688d1d2e242a61faf`.
Main integration `33aeb7f7` retains the existing TR-01/02 source, tests and coverage rows;
the only conflict was the crypto test header, resolved by preserving both ID tags and lifecycle imports.
Coordination: https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5983511741
Status: MERGED (#506, merge e7cdcd8d756a3b8a1ec69c6e953115f2ce8df02f; TR-06, AT-TR-06, SC-060 approved).

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
- Integrated full suite: 9953/9953 PASS with the repository's existing CI unit
  network boundary. Earlier unbounded-network runs hit the same three UTILTS
  fixture timeouts on unmodified main; the fixture repair belonged to ENV-01/#504
  and is now merged separately. No timeout or assertion was weakened here.
- All nine applicable exact-head GitHub gates PASS on bfd5bc8e: verify, quality,
  clean/upgrade migration replay, smoke, coverage, browser-public, targeted
  regressions and PR certificate. #506 merged after reviewing intervening
  #502/#504/#505 changes and preserving their approval rows.

Synthetic source registration proves guarded code behavior and cryptography;
it does not prove a live issuer registration, database RLS or market activation.

## Separate follow-up packets

Preparation #510 (merged a40b5732 after nine exact-head gates) supplies companyId at all four callers and the already computed
businessCode in transport metadata; 14 real-resolver/crypto/AGT behavior tests.
Readiness #511 uses the sole validated resolver and its actual PEM fingerprint;
18 behavior tests prove successful own-company readiness and rejection effects.
Together: independent parent 199/199 in nine security suites, full 9985/9985,
types/lint/architecture checks PASS. Both source heads are published and retained; #510 is merged and #511 now
targets main after its own CI gates. SC-041-only #513 is independent.
These packets do not add further TR rule approvals or database/market claims.

## Next action

Merge retargeted #511 after its own gates pass. Hold independent #513 and this
handover branch outside main until the integrator releases the shared-file merge
window; #513 also requires its own complete gates.
Record one handover line per actual merge; keep shared campaign memory intact.

Skill routing: using-superpowers/executing-plans/using-git-worktrees for isolated
continuation; spec-to-code-compliance + independent read-only reviewer for the
literal card; test-driven-development/systematic-debugging/fp-check for the
reproduced tenant defect; Supabase for the protected read boundary;
verification-before-completion/requesting-code-review for approval. No schema
change, UI/performance work, new dependency, hook or skill authoring is in scope.
