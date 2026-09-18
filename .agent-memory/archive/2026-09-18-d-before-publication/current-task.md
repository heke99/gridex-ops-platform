# Active unit — source-bound PRODAT subtype D conditions

Status: BLOCKED for publication; tests, types, coverage, retained quality gates, final local full build and bundle budget pass; publication, ordinary CI and independent review remain open.
Branch: `codex/ediel-v2-dependent-conditions-20260918`.
Remote base: `b916213e83871e9f4d15b9fd52a2b8c19394c9ca`.
Exact baseline tree: `54f9cf4fe56e42768ef132a23f6a79baea0632d5`.

PR328 is merged. Do not restore register code or redo its closed review findings.
The existing D branch was read from GitHub and was identical to main. This unit's
changes exist only in the local candidate/patch: no new PR, push, CI or merge.
The current connector exposes read tools only; no CLI write credentials/network
are available in this workbench. Do not weaken protection or use another
service's secrets as an indirect GitHub write channel.

## Implemented scope

Six original numeric cells: Z06:508/217/306/254 and Z09:216/217. Subtype
requirements are required/optional/forbidden/undetermined, not an unrestricted
byCell checkbox. Actual first-register field223 is authoritative per object;
other objects/agencies/registers/messages and stored root statuses cannot supply
it. Canonical all/dependent-only validation and row/send guards use this source
rule. Mandatory/forbidden/unknown outcomes cannot use the intentional-invalid-
test-send bypass. Shared date placement/format checks remain in force.

This does not certify the other 104 D cells, full grammar/ACK mapping, F3–F7,
any live market test or release. Prior register/date acceptance is not undone.
No schema, SQL, generated database types, dependencies, privileges, production
data, storage or actual market messages were changed. PR310 remains paused at
`e961135199f292b8210884f07de3b616a670161a` and is excluded.

## Exact next action

Read the completed local qualification audit, then publish the guarded patch on
this existing branch through a write-capable environment. Read current main and
branch first; never overwrite an advanced branch. Run all ordinary workflows on
the exact published head, obtain independent substantive review, resolve findings,
and merge only after the gates pass. Continue the original D inventory afterward;
never mark the remaining 104 or later masterplan phases complete from this unit.

Evidence: `quality/audits/ediel-masterplan-v2/f3-d-subtype-qualification-20260918.json`,
`f3-d-subtype-review-20260918.md`, `f3-d-condition-inventory-20260918.json` and
`pr328-merge-receipt.json`. Historical prepublication memory is archived under
`.agent-memory/archive/2026-09-18-pr328-merged/` without alteration.
