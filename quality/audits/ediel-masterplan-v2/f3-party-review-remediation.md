# PR326 — four review findings: reproduced and corrected

2026-09-17. Status: IMPLEMENTED_NOT_VERIFIED for merge (ordinary new-head CI and
substantive review still required). One active item: PR326. This closes neither
the entire F3 phase nor the masterplan. PR310 remains paused and untouched.

## Exact starting point

PR326 branch `codex/ediel-v2-prodat-party-fields-20260917`, published head
`a7b4ddde165ab4ef947715685f80e49360c3133c`, tree
`3ab14547025af2310e3f68ff7a2f9f6185aa3011`. Main is the PR325 merge
`2d65dc9fdc66738cc66984ec91350adace34eb0d`.

The older four ordinary workflows were green but the completed substantive
CodeRabbit review had four unresolved findings. Its success status meant review
completed, not acceptance. None of those old green checks qualify this change.

Recovered ordinary source artifact10498282022 (run35223964004) ZIP SHA256
`a044c652b55daee5432fcfe1c378015de2b471dc73d44cea5546fd95304ce859`;
inner source SHA256 `e594093c641328a22a4b4f07a5dae65e7416e7709def0c9b6db331f97307257a`.
Its checked-out merge8e56c37f has the exact above source tree, verified locally.
Locked dependency artifact10496783500 ZIP SHA256
`9efe8762508b0ff6e80c95b1a16d7d744f4d104f745bd3d510d2479462424dd2` and inner
node_modules SHA256 `ec448a0bc67303d21b875dba29c2ddce839935c163c327d59323a01870afd2e0`
were verified. Its package-lock bytes equal the source package-lock exactly,
SHA256 `88f4f36c97b4896442c3ce9cb837ea7f93a0fee55e6b63b477421b33b4b73d6b`.
No dependency version/lock update. Local node22.16.0; final runner uses normal
CI node22. The local snapshot commit is not repository ancestry and is not used
as a parent of the published correction.

## Finding resolution and variant tracing

1. **4037255150 / payloadPreflight.ts.** Use tokenized tags, original UNA and
   `segmentComposite` throughout the envelope/profile/count/reference/length/
   date/PRODAT preflight boundary. Markers are actual tags, never text embedded
   in a field. Decoded length is measured once; original raw segments remain in
   diagnostics. Segment-profile selection receives UNA. No missing-segment,
   count, correlation, length, party or date gate is removed.
   Tracing the real preflight call chain also reproduced rulebook AI-list
   misclassification of semicolon-UNA and loss of rulebook UNB metadata/UNH
   profile/business date. Its PRODAT parser now carries UNA and reads raw
   components exactly once. Valid default escaped subaddresses had also shifted
   interchange/application fields at the old preflight split boundary.

2. **4037255164 / buildProdat.ts.** The compatibility builder accepts explicit
   legal sender/receiver IDs and countries. These affect NAD FR/DO only; UNB
   retains technical gateway actors. Omitted/null legal values keep the explicit
   existing same-party/SE fallback. Supplied blank/oversized/invalid legal
   values are rejected, not silently replaced. Existing profiled-builder
   semantics, source NAD shape and original normative inputs are unchanged.

3. **4037255171 / compatAdapter.ts.** Metadata is read from tokenized UNB/UNH,
   the header DTM137, and the first object's legacy DTM7/LOC48 positions, using
   the declared UNA. Flat application reference rejects composites. Escaped
   subaddresses and reference punctuation survive. Missing metadata cannot be
   supplied by the next object/message. Legacy date-only 102/203 projections
   validate their exact value/format/calendar component without stripping
   punctuation into a plausible date. Full DTM field/time semantics remain the
   next separate task; no new normative date mapping was asserted here.

4. **4037255183 / fieldMatrix.ts.** Mapped transaction NAD rules are evaluated
   per LIN object. A forbidden field/group in any object is rejected; a required
   field/group must be available in each object; allowed-value checks run for
   each. FR/DO remain header-scoped. Scalar projections intentionally still
   read the first object, so fixing validation does not merge identities across
   transactions. First-message boundaries are preserved and national dependent
   cells are not made unconditional required. Non-NAD rules retain their scope.
   Raw DTM/LIN/UNH presence selectors now use UNA as needed by the real preflight
   path, without upgrading incomplete DTM/regional/register semantics to passed.

## Executed tests (before publication)

New permanent actual-module suite:
`__tests__/ediel-prodat-party-review-regression.test.ts`.
Independent synthetic fixtures, three declared separator alphabets, actual
preflight/parser/builder/rule-matrix modules, no live database/network/SMTP.

- Initial42 cases: old application source11pass/31fail, corrected42pass.
- Expanded final87 cases: unchanged published application source30pass/57fail;
  corrected87/87. The old-head baseline is a separate clean worktree with only
  the new test file added. No assertion weakened to obtain green.
- The same87 pass under Europe/Stockholm and Pacific/Apia (not extra unique cases).
- Full Vitest1434/1434 in210 files. The87 new and50 earlier NAD consumer cases
  are included, not added again. All retained source harnesses848/848 pass.
- Application, script and test TypeScript pass. The first local typecheck found
  diagnostic token-to-string typing mismatches; those were fixed, not suppressed.
- Changed-file ESLint0 errors with8 retained compatibility-file unused warnings.
- Existing Z01 golden and aggregate route-readiness regressions pass.
- Immutable specification integrity:33files/121rules/231contracts unchanged;
  existing large-source budget and whitespace checks pass.

Controls include valid full Z18, genuine missing envelope segments despite fake
segment text inside FTX, bad counts/refs, missing required UD/DTM164, decoded
35/36 lengths, distinct legal/technical actors, exact escaped metadata, malformed
application/date components, optional-D behavior, later-line forbidden/required/
allowed-value cases and next-message isolation. Dates cover leap-day and bad
calendar/clock/format in the bounded legacy projection. The permanent Ediel
workflow now runs the new suite alongside every existing test/gate.

## Merge gate and remaining work

Run all normal OPS, Ediel, Browser/Quality and FullE2E checks on the NEW exact
published head, including ordinary main replay, application/script/test types,
full tests/lint, API/RBAC/security, build and unchanged budgets. Inspect review
findings, not just the green bot status. Merge only exact tested head with no
unresolved blocking review. A transfer helper, local suite or previous CI is
not a release certificate. Any source-transfer files/workflows must be excluded
from the application branch and main.

After verified merge, continue DTM fields, then register/dependent conditions.
No PR310 SQL/types/proof machinery, normative/TGT originals, RLS/grants,
production storage/data mutations, deployment or external market message are
part of this work. Full F0/F2/F3/F5/F7 and external-source approval remain separate.

## Skill routing

Used repository receiving-code-review/systematic-debugging/test-driven-
development for verified reproductions, spec-to-code-compliance/variant-analysis
for source and caller tracing, and verification-before-completion/quality-
playbook for regression and exact-head gates. No UI/browser implementation,
production database change or dependency upgrade required a separate design
track. No unavailable subagent/CLI review is claimed. Source/review checks are
required before merge; a later checkpoint must read actual GitHub status.
