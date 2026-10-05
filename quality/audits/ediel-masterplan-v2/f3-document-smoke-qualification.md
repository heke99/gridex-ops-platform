# F3-E — route-readiness smoke guard follows the real BGM renderer

Final source3423818 passed the ordinary Ediel and browser workflows and full
Vitest coverage, but FullE2E35215042293 correctly failed its smoke gate. Retained
artifact10494685148 (ZIP SHA256c0611f966c04df5e25260f91d8ec76ecb53f9658d5d7a122209002b651167dd1)
was downloaded and verified. Its report has14/15 smoke steps passing; the sole
failure is08-route-readiness/ediel-z01-golden-regression.cjs. The report's broad
'database_or_migration_drift' heuristic is not the actual failure diagnosis.

The old static assertion searched for a literal BGM string in profileRenderer
or engine. F3-E delegates that rendering to renderProdatDocumentHeader, so the
assertion no longer examines the owning code. No actual BGM rendering failed
in the real-source/consumer suite. The corrected guard requires the explicit
renderer call and executes the145 independent source/consumer regression cases
as a blocking child process. All existing Z01/route/test-flag/subaddress checks
remain; a BGM word in a comment cannot satisfy the behavior guard anymore.

Reproduced the failing old smoke assertion locally (exit1), then the revised
guard passed (exit0). The exact aggregate command
npm run gridex:production-route-readiness-regression also passed locally,
including materialization/send-guard/Z01/strict-transport checks. These are
local source checks, not live DB/SMTP. No original fixture, required gate,
threshold, production behavior or PR310 resource is relaxed or removed.

This correction and note need fresh ordinary CI on their exact published head.
The earlier partial green/isolated runs do not authorize merge of this head.
