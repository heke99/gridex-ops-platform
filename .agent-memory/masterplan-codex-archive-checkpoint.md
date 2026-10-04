# Codex — masterplan v2, TR-03 / TR-04

Status: IN_PROGRESS. User requires collaboration with Claude, complete GitHub
publication and gated main integration. No production storage/mail/database use.

## Coordination and baseline

- TR-03/AT-TR-03 and TR-04/AT-TR-04 claimed in PR #491 5982461436;
  Claude explicitly confirms 5982462631. He retains TEN/P/U implementation.
- Branch `codex/ediel-tr03-tr04-archive-20261004` starts at published #498
  91bce1600e3cf6f3919539638acfa0e9a7840337. #498 is ready and contains
  verified TR-01/02, complete suite 9856/9856, types/gates PASS. #497 contains
  TEN-07 and genuine pending ESCO native assertions; current head f4a0fb43
  has verify/quality/upgrade PASS, clean native still running. No ESCO approval.
- Claude #491 head 25e6ce91: TEN-09 wrapper renamed 20261004170000, schema
  capture pending, no duplication by Codex. His next claim U-12/U-15 is a
  distinct UTILTS batch planner; current changes touch transport attempt gates.
- Using existing TDD/independent spec-to-code review/delivery skills. Separate
  read-only reviewer ten07_rule_review performs full TR-03/AT-TR-03 review.
  Frozen rule cards and acceptance contracts are not edited.

## Reproduced TR-03 defect and correction

- Source-traced Z08/LK exemption returned by the sealed source owner after the
  first actual archival callback caused correctionOutboundDispatch to call
  sendGenericFencedEdielEmail, invoking sendEdielEmail a second time.
- Actual helper/writer/MIME-compiler regression RED 3/3: raw and attachment
  modes create two snapshots; S/MIME converts its legacy token on the first
  archive, then fails smime_archive_snapshot_missing before SMTP. No duplicate
  SMTP or cross-tenant disclosure is claimed. Reported in #491 5982557216.
- Expose the existing generic attempt logic as one closure (entry/capture/fail).
  LK passes the already archived binding to that closure inside the existing
  helper callback, then captures that single provider result in the generic
  ledger. Source-owned exemption selection and sealed-H behaviour stay intact;
  generic prepare/enter/observe/error/no-resend rules are reused unchanged.
- No archive/source SQL, schema, migration or generated-type change.
- Targeted GREEN 35/35 first; expanded 61/61 in seven files after asserting
  actual verified retrieval, exact uploaded/provider bytes, distinct RFC versus
  provider identities, one archival and public repeat-send historical repair,
  current actor denial, altered storage denial and generic timeout retention.
- DB/authority receipt ports are declared finite fixtures; storage returns
  bytes actually uploaded in a private in-memory map, and provider is mocked.
  Opaque synthetic CMS bytes prove archive flow only, not valid encryption.
  Real independent SQL transport-copy regression supplies owner qualification
  assertions; its pseudoreference alone is not retrievable byte evidence.
- First typecheck caught Buffer/BlobPart generic incompatibility in the test;
  use an explicit copied ArrayBuffer, preserving exact bytes. Final checks pending.
- TR-03 tags accompany asserting archive/retrieval and SQL wrapper tests;
  coverage remains NOT_VERIFIED until complete review/verification.

Next: publish this work as a draft stacked PR, finish TR-03 full-card review,
applicable tests/types/gates and then approval, before implementing TR-04.
Continue integrating exact-green #497/#498 into main while Claude does his cards.
