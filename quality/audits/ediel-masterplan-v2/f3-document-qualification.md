# F3-E — published CI failure and completed ACK-path correction

This supersedes publication/test-environment limits in f3-document-fields.md,
which records the earlier local checkpoint. Final normal PR CI remains required.

Source70f5632d is published in PR325. Diagnostic35213650194 pinned that exact
head/tree and uploaded JSON plus the input test. Verified archive10492987710
SHA2561060e04527a1c42db4d8ae379ccf2d91f296f77cf529e60ab41233e1047eb2c7 reports
1293/1296 tests passing. The failures were: P-APERAK preflight counts an escaped
apostrophe as a segment; the canonical RFF reader double-decodes a trailing
literal release; and a synthetic P-family row incorrectly retains U-family wire.

The common canonical reference reader now uses wire-backed segmentComposite;
preflight uses the established tokenizer for all EDIFACT family segment counts.
The source BGM identity is preserved into the actual ACK/preflight consumers,
not just the lower renderer. The contradictory fixture now has a positive P
wire and explicit rejection of the original P-row/U-wire mismatch. The19
consumer cases, field length and security checks are not removed or relaxed.
Twelve independent ACK-wire cases yielded9pass/3fail before repair,12pass after.
Early exploratory cases with unrelated custom-UNA canonical scope and an
incorrect total-segment expectation were corrected/excluded before that bounded
reproduction; they are not counted as product defects or formal acceptance.

Isolated qualification35214234089 passed1296/1296 actual Vitest tests and all
three TypeScript groups on74bed19f/treefc138228. Archive10494273554 SHA256
79d7187add80148f3c923b98020beb2a99796740de1deba30aa73b962684470b is retained.
This is not a substitute for ordinary final-head CI. Final review closes one
more source-presence hole: any nonempty P source without its own valid BGM is
blocked, not treated as structured-only legacy. Four adversarial cases failed
before and pass after. Final source harness145 cases (129initial +12ACK +4source
presence);439 earlier cases retained.584/584 pass locally. Full normal CI must
run after this final source/documentation change. No merge/live/TGT acceptance
is recorded here; no PR310 data/types/grants/migrations were imported.
