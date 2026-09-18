# PR330 independent-review remediation — 2026-09-18

## Finding and reproduction
Independent CodeRabbit static reviews5730637320 and5730659831 of exact0a89e102
identified the successful-policy bypass: wireZ09E/E34 missing field216 could be
validated as rowZ06E, where the migrated Z06 fields are optional. The reviewer
inspected source and tests; did not execute repository tests. A fresh local probe
confirmed the old standalone send guard ALLOWED absent or rowcodeZ06 evidence.
WirecodeZ09 evidence correctly failed its binding first, so that preliminary
fixture was not credited as the real bypass. Refined33-case red baseline32fail/
1pass is retained by digest. Test counts are not added across staged baselines.

## Correction
Real PRODAT bytes are reparsed before sync/registry policy dispatch; the wire
UNH/BGM wins over rowcode/family and a stale parsed cache. Row preflight also uses
the actual wire family. The new six-row subtype requirement table and all nested
source outcomes are frozen at runtime. No normative requirement changed.

A new list-payload control caught an introduced probe hazard (34cases:33pass/
1fail): unconditional EDIFACT tokenization consumed literal question marks.
The probe now activates only for an EDIFACT header prefix. All34 review cases
pass. Wrong-code/family tests cover both environments and3UNA alphabets, actual
Z06E optional positives, registry/sync calls, and system-test ACK flag. Existing
146 D cases and older assertions/thresholds remain unchanged. This is not a
complete classification, parser, zero-LIN, multi-message or live-market certificate.

## Fresh qualification
2474/2474 application cases in236files (34review cases included),851/851 retained
source cases,3TS projects, coverage, lint, original source integrity, mechanical,
quality tests, RBAC and unchanged source-file budget passed. Coverage35.52lines/
34.10statements/27.01branches/40.92functions. Command/log hashes and empty source
drift are in the adjacent JSON. An earlier45second app-type wrapper timed out;
a fresh72.1second run completed successfully, not inferred from the empty log.
No new-head ordinary build/replay/CI or final rereview is claimed here. The source
artifact and native PR must bind those checks to the actual new head before merge.

## Publication history and boundaries
Original user ZIP/74checksums/38files and base archive were verified byte-for-byte;
head0a89/treeaa624 preserved the original source. Its four ordinary workflows
passed, but review correctly prevented merge. This follow-up is new source,
not a claim that the recovered ZIP originally contained these repairs. Historical
local audits and prepublication memory remain unchanged in their historical paths.

PR310 remains paused/excluded. Six original numeric D cells only;other104numeric
cells and10parent groups/fullmasterplan remain separate. Existing main fullE2E
35334649693 still has3failed certificate steps and is not certified by PR smoke.
Vercel readback shows existing Git auto-deployment of mainb916 after PR328. Future
authorized main merges may likewise deploy automatically; no explicit deployment,
settings, SQL/types/grants, live DB/storage or real market messages were performed
by this remediation. Review and exact-head ordinary CI remain merge prerequisites.
