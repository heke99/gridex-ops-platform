# Current state — PR326 F3-F NAD qualification

Updated2026-09-17. PR325/324 are actually merged; current base main2d65dc9.
Single active item: complete ordinary final-head qualification of PR326, branch
codex/ediel-v2-prodat-party-fields-20260917. Initial head aadcd597/treee3b2a640
is published, not local-only. Initial ordinary checks found actual-module test
failures; the initial head is NOT qualified. Publication/diagnosis/corrections:
quality/audits/ediel-masterplan-v2/f3-party-qualification.md. Original audit is
historical. Transfer/diagnostic helpers are isolated and never merged.

Exact dependencies are now available locally from the checksum-verified locked
CI artifact. Corrected full application tests1347/1347 in209files, including50
NAD consumer cases, and848 source cases pass. The initial actual-module suite
was1334pass/6fail. Two genuine UNA canonical-reader failures were exposed after
repairing incomplete synthetic policy fixtures; raw structured decoding fixes
those. Synthetic party fixtures were corrected with positive/negative evidence,
not by weakening source rules. Final ordinary types/tests/lint/API/RBAC/audit/
build/budgets/replay/browser/smoke/certificates and review remain required.

NAD legal/technical actors, UD/IT/IV and source-company permission matching stay
separate. The original33files/121rules/231contracts and13usage columns remain.
This is not full F2/F3/F5/F7, all74fields/110D/full grammar, live market acceptance
or whole-plan approval. PR310 remains paused/e9611351 and is not touched.
No SQL/types/grants, production mutation, explicit deployment or external mail.
After exact-head qualified merge, continue the remaining DTM/register/D work.
