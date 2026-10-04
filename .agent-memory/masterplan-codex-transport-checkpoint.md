# Codex — masterplan v2, TR-01 / TR-02

Status: IN_PROGRESS. User explicitly authorizes GitHub collaboration with Claude,
publication of every work result and integration to main after review and CI.
No production deployment, database mutation or real market mail is performed.

## Ownership and shared channel

- Codex owns TR-01/AT-TR-01 and TR-02/AT-TR-02, claimed in PR #491
  comments 5982107326, 5982173781 and 5982200169. Claude acknowledged
  in 5982240442 and excludes these files. Codex excludes Claude's remaining
  TEN/P/U/ACK implementation. Each new card requires a fresh GitHub claim.
- Isolated branch `codex/ediel-tr01-tr02-transport-20261004` starts at
  published #497 head a01e8dfc03eeb76c59d1c54b39eb6a9f57c94dc5.
- #497 contains verified TEN-07 and genuine, still-unexecuted ESCO-10/11
  native assertions. No ESCO approval is inferred from tags or finite fixtures.
- Claude reports main integration in 5982277365: reuse main's upgrade/history
  scripts rather than maintain the A1/H1 alternative. Main fetched at 8f3b42f1.
- Shared status 5982337348 records publication/main instruction and review gaps.

## Changes and behaviour evidence

- TR-01: block production test-portal SMTP destinations before new authority
  reads/provider entry, after historical accepted-receipt repair. Share the
  destination policy with route selection. Actual email selectors, readiness,
  MIME composer and SMTP/Resend adapters assert independent configured lanes
  and propagation of provider failures without fallback; external providers
  and archive ports are finite test doubles, with no real mail.
- TR-02: both existing generic and sealed-Z08 attempt lanes preserve full
  error.response, observed smtpCode and an unambiguous queueId. Missing or
  ambiguous evidence is null; archived RFC Message-ID and payload hashes
  remain bound to one attempt. Accepted SMTP is not delivery or business proof.
- Generic ledger SQL matrix executes the real prepare/enter/observe owner for
  250/450/550/timeout, exact retained JSON, replay immutability and no second
  dispatch. Existing accepted/source SQL owners assert separate delivery,
  technical ACK and business response effects, with named upstream fixtures.
  No native sealed-H or authentic SMTP-delivery claim.

## Verification and independent review

- Initial recipient regression RED 5 / GREEN 8; initial SMTP evidence
  regression RED 10 / GREEN 10. Targeted combined suite 38/38 PASS;
  channel suite 6/6 PASS; node SQL wrapper 3/3 PASS.
- Application, tests and scripts TypeScript checks PASS.
- First complete unit run: 9516 pass / 12 fail (four exact receipt fixture
  expectations needed explicit null fields, plus eight sandbox child-process
  EPERM failures). Updated the fixture without weakening assertions and used
  the existing CI loopback preload with permitted child execution.
- Corrected complete suite: 9528/9528, 728 files PASS (189.83 seconds).
- Independent full-card reviewers require: actual RFC parsed destinations
  including trailing comments and legitimate display-name controls; configured
  non-ediel.se test_portal aliases; ambiguous queue-label assertions; explicit
  APERAK-versus-CONTRL/business SQL preservation. Coverage remains unapproved
  until these gaps are closed and independently reviewed.

## Complementary TEN-09 review and native limitation

- Codex abandoned duplicate TEN-09 implementation before any production or
  coverage edit when Claude reported ownership. Direct resolver/coordinator
  timing difference was reproduced with actual SQL but does not alone prove
  illegal historical permission access. Refutation recorded in #491
  5982182197. No demonstrated grant, data read or wire/termination side effect.
- Claude records explicit owner decision 5982240442: reuse follows the same
  DSO-network/three-year timing bound even for older approved history. His
  forward wrapper (now 20261004170000) remains PARTIAL pending real native
  resolver execution. Codex made no resolver/schema change.
- Standard local Supabase image pull hit the Docker image-storage quota;
  native tests never started. EXIT cleanup restored migrations/seed and stopped
  the owned stack. Removed only the six images loaded by this attempt; no
  global prune. An earlier broad Docker-socket helper was rejected by automatic
  approval and was never started. Existing GitHub native CI remains authoritative.

Next: close review gaps, publish this checkpoint with code/tests in a small PR,
integrate current main into #497 using its CI scripts, and continue other
unclaimed cards while native CI runs. Keep every work result on GitHub.

## Review corrections and publication checkpoint

- Added reviewer cases first: 6 failures / 9 passes reproduce trailing-comment
  bypass, legitimate display-name false positive and missing alias/read guard.
  Replaced the regex with installed Nodemailer's actual flattened mailbox
  parser. Read active test_portal addresses through tenantDb(company_id),
  retaining test environment and explicit failure when policy is unavailable.
  This read follows the existing actor-qualified accepted-journal lookup and
  historical repair; it cannot authorize provider entry or create a receipt.
- Configured aliases, another tenant, inactive aliases and read failure are
  asserted through the public send boundary. Added a historical production
  repair case with current portal addressing and no new provider entry.
- Added ambiguous queue-label assertions in both real fences and APERAK
  pending/received preservation beside independent CONTRL/Z02 owner state.
- Corrected targeted suite 49/49 and SQL wrapper 3/3 PASS; one TypeScript
  unknown-row diagnostic was corrected with the explicit selected-row shape.
  Complete final rerun and review are pending at this publication checkpoint.
- #497 main merge f4a0fb43 takes main's CI files. No duplicate CI implementation.

Next: publish as a draft PR, complete the new full suite/types/lint and final
independent review, approve only proven IDs, then merge after exact-head CI.
