# F3C-05: UTILTS message function field 204

Base: draft PR #381 corrected published head `28ed2fc3a353c03058e9363b06a40a49235cef20`, same tree as local `24125bfa`. Separate stacked draft; PR #372 and paused #310 untouched, no merge or staging.

Source: 25-A-3 annex C common header field 204 BGM/1225 is required, and UG-122-8 allows only 5 or 9. `utiltsFieldMatrix.ts` and the retained `fieldMatrix.ts` own this allowed list. The canonical runtime facade reads BGM using declared UNA and feeds `resolveCanonicalRuntimeDecision` and the real inbound processor. Before this change, it validated field313 but never projected field204 into final guide issues.

RED: a complete monthly E66-S with a genuine E19 meter-reading/energy mismatch and only BGM/1225 changed to blank or XX returned `functional_rejected` and UTILTS_ERR. The shared header guide now consumes the existing 5/9 rule. Missing function produces ERC41, invalid function ERC42, both with FTX204 and negative APERAK; no final ERR. Valid 9 control still exposes E19, and valid 5 has no field204 issue.

Actual inbound processor test with external DB/sinks mocked sees `guide_rejected`/negative response at the persistence RPC, APERAK containing 204, no UTILTS_ERR, and no meter, billing or request-completion call. The existing database persistence owner writes business series only for accepted dispositions; this test does not claim native persisted proof. Local relevant 25 files 311/311 PASS, app/test typechecks, scoped ESLint and diff check PASS; after adding the valid-5 control, its focused rerun also passed.

Predecessor PR #380 passed all four ordinary exact-head workflows. PR #381 first published head `a307b91e` failed full E2E coverage because a synthetic structural fixture set receipt 00:00Z before its 18:11+01:00 document creation; that fixture was corrected without weakening the 205 rule, 29/29 local PASS. Corrected PR #381 head `28ed2fc3` had Ediel/full E2E/OPS in progress and browser success at last check. This batch needs its own ordinary exact-head CI.

Next finite review: fields202/203, especially BGM document identifier nonblank/unique-over-time and exact ACK attribution before a genuine E19. E66 conditional 209/533 per physical IDE still needs a distinct regulating-object persistence identity; custom UNA timezone conversion is fail-closed. F3C-04 native Z04, F3C-05 literal staged guide/function and native mixed ACK/storage, F3C-06 grammar, F3C-07 ledger, F1/F2 and F4-F6 remain open. External staging/TGT/AGT/counterparty/market sends are deferred.

Skill routing: continued repository `using-superpowers`, `spec-to-code-compliance` rule/owner/consumer trace, `systematic-debugging`, `test-driven-development`, and `verification-before-completion`. No UI, schema edit, security review or parallel-agent work was triggered.
