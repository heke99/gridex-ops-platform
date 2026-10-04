# Codex — masterplan v2, TR-04

Status: IN_PROGRESS; TR-04/AT-TR-04 are VERIFIED/PASSED in the inherited
PR426/main coverage. This session repairs newly reproduced gaps and refreshes
their evidence; no new native approval is claimed before execution. Branch
`codex/ediel-tr04-dsn-20261004` starts at published #500
1187da94760b4e0a14e4a69dfca75bd4a5f9b9d5. User authorizes GitHub publication
and gated main integration, requires collaboration with external Claude.

- Exclusive TR-04 ownership confirmed by Claude in #491 comment 5982462631;
  current updates 5982618486, 5982755224. Other Codex bot 5982709321 made
  no changes. Claude retains TEN/P/U, latest #491 00bf86b3; his only forward
  migration is 20261004170000 and its real capture receipt is published.
- Actual classifier/parser RED3: forwarded DSN through RFC2231 boundary*
  bypassed structural classification; malformed wrapper was uninspectable.
  Added bounded parameter decoding and fail-closed classification on MIME
  inspection issues. GREEN31 classification/disposition tests. No business
  write or duplicate SMTP defect inferred from this parser differential.
- Extended actual SQL baseline: exact stored report, attempt/message binding,
  read fields and wrong RFC/recipient denial; 27 checks PASS. Fixture exports
  retain the DB only when explicitly invoked by the extended child harness.
- New encoded regression loads the actual TS parser via restricted VM linker
  and actual record_dsn_v1 plus latest sending-mailbox qualifier. Plain control
  and mailbox PASS; base64/global status and returned headers fail with
  ediel_dsn_source_invalid after 2 new checks, despite matching attempt/RFC/
  recipient. Original identities are absent from literal source, as asserted.
  Initial harness exitCode assertion was corrected before this actual RED;
  that setup error is not evidence of a production defect.
- CLI created 20261004175536_ediel_dsn_encoded_source_identity.sql using
  pinned Supabase CLI. No old migration, schema snapshot or generated type
  edited. Implementation/checksum/capture still pending. Local telemetry
  network warning did not prevent file creation; no database deployment.
- Applying previously read TDD/spec-to-code/verification and Supabase skills,
  including PostgreSQL privileges guidance. New source helper must derive
  typed identities/fields from captured MIME, preserve raw hash, private ACL,
  record function OID/catalog metadata, tenant/actor qualification and immutable
  observation. No delivery/resend/business authority and no caller proof flag.
- Local SQL uses finite synthetic DB ports, not native/authentic market proof.
  Native capture-only workflow is triggered by migration-history manifest;
  import schema/types/fingerprint byte for byte with exact SHA/run/hash receipt.
  It does not replace mandatory OPS native/upgrade/parity verification.
- #497 exact f4a0fb43 all OPS and auxiliary jobs green, native artifact
  11310821113 available; inspect actual ESCO three-test output before approval.
  #498 current clean pending. #500 regression CI failed in PRODAT identity
  consumer job; inspect actual failure rather than equating full local PASS
  with complete CI. All existing implementations/checkpoints are on GitHub.

Next: implement bounded encoded MIME source binding in the new forward file,
negative spoof/ambiguity/field/ACL checks and valid attributed processor matrix;
publish draft with this memory, independent full-card review, checks and actual
capture. Integrate already green PRs to main; preserve Claude coverage union.

## Forward implementation and asserting checks

- New private helpers derive the complete report from bounded captured MIME:
  strict base64/QP decoding, regular/RFC2231 boundaries, depth16/256 entities/
  25MiB source/64KiB fields, one status and same-parent returned RFC identity.
  Compare the whole typed report, including optional original recipient,
  diagnostics, MTA/date fields; report text in prose supplies no identity.
- Rewrite only the old three literal-source checks using the existing owner
  function definition; assert OID/catalog metadata unchanged. All original
  actor/tenant/source-lock/hash/candidate/immutable/no-authority logic remains.
  Six helpers revoke direct execution from all application roles.
- Initial forward green caught the decoded CRLF normalization gap; corrected
  before publication. Actual expanded wrapper PASS includes ordinary/base64,
  sealed-H, quoted-printable body_text and forwarded RFC2231 attachment
  observations; exact report/attempt/message/hash/lane/replay; retained
  attempts/events/witnesses/messages/memberships/profiles unchanged.
- Negative owner/helper assertions deny forged identity, recipient/action/
  status/diagnostic/MTA/date/envelope fields, duplicates, malformed/unsupported
  transfer encoding, boundary/depth/header-limit failures and prose spoof.
- Valid attributed raw/body/attachment processor matrix executes actual
  classifier/parser/candidate/source/status adapters with declared finite
  DB/RPC ports. Embedded EDIFACT and AI fallbacks never reach business/ACK/AI
  ports; original payload remains, exact source hash/recipient/report retained.
  Lookup/write failures retain transport quarantine. Targeted 52/52 PASS.
- Actual native helper/parity/ACL tests added to mandatory native config;
  pending real execution. Full unit suite/app/test types still running;
  scripts types PASS, lint zero errors (one ignored CJS warning).
- CLI forward checksum registered, migration integrity PASS1059 files/962
  groups; frozen specification integrity PASS121 rules/231 contracts.
- Parent #498 actual-parser VM bridge64878fd7 passes1012 standalone cases;
  imported published parent #500 e7067be1. ESCO native review approved;
  parent #497 four-row approval59c065a4 published, exact-new-head CI pending.
- Publish draft to trigger real schema capture. Generated types/schema/
  fingerprint and manifest remain the prior baseline until capture import;
  generated-tail/schema comparisons are expected pending, never called PASS.

## Complete-card review and local verification

- Full suite9870/9870 tests in760 files PASS314.35 seconds. App/tests/scripts
  typechecks all exit0; owned lint zero errors. SQL checks27+32 PASS.
- Independent full-card reviewer finds no remaining card effect or binding/
  ACL/metadata defect atc3aeaefa. Actual native parity/ACL and mandatory
  upgrade/CI remain merge gates; synthetic fixtures do not prove SC062
  authentic delivery/E2E or production acceptance.
- Correction: the earlier resumable summary incorrectly described TR04 as
  unapproved. Inspection of the committed parent shows VERIFIED/PASSED inherited
  from PR426. Preserve that existing approval and update its code/test evidence;
  do not fabricate a new approval or edit another agent's coverage status.
- Draft #501 published c3aeaefa; real schema-capture run37224099718 queued.
  Initial generated-tail/schema checks remain pending artifact import.
