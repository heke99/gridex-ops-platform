# PR370 external-review remediation — native evidence and delivery boundary

Base of this correction: a89275ba0b34ae27530c2e403d3ae3f2667afe3b. Ordinary OPS35715146276 succeeded with5514/337tests, types/lint/build/API/RBAC and clean replay105+62+84SQL/3upgrade checks. Those results do not override external findings4070685162/4070685166 or the incomplete full source-disposition owners.

## Findings verified, not blindly adopted

External CodeRabbit review found missing mandatory occurrence/object fields and time fixtures masked by contradictory receipt contexts. Actual native35718179577/artifact10690304766 reproduced the stored-receipt counterexample: minimal observed occurrence plus empty object was persisted by the original function. Of64new assertions,55failed and9passed before the forward;64passed after. A genuinely captured null-payload source was ALREADY rejected by the original receipt-context binding. The reviewer null-hash example is not claimed as a demonstrated old exploit; an explicit enumerated-hash invariant is additional defense.

The forward20260922105251_ediel_received_discovery_shape.sql was genuinely CLI-created and applied using2.101.0 in isolated localhost replay. It preserves ownership, grants, RPC signatures, tables and old migration bytes; only existing private append_discovery validation changes. Mandatory JSON keys/types, sequential physical ordinals/increasing segment indexes and exact message/identity/agency membership arrays are checked before INSERT. Incomplete/unresolved records stay storable when correctly typed, but cannot claim enumerated. This is not a second canonical wire parser or an approval owner.

Existing two time tests keep their read_failed/hidden-result assertions. Future receipt uses coherent factory overrides; malformed calendar uses absent context so the row check is independently tested. Both fail by assertion (2failed/87notselected) when the row receipt boundary is removed, and pass before/after restoration. All89inventory cases and full5514/337 suite pass normally; no tests are skipped in the full suite.

Native root application/test typechecks, full tests, lint (0errors/101existingwarnings), migration check and service-role ratchet all passed. Old SQL and upgrade checks reran unchanged. Twice-generated types are unchanged; twice-generated schema differs only in the existing private function body. Artifact SHA256dc4f8be4568dd0dff393440fd737a6746c0fcd0e5805a1b5dc550d0eb3846a12 and all9delivery blob/hash pairs were locally verified.

## Final delivered fixture qualification

After that native run, the two positive register-repetition and distinct-message SQL fixtures were made faithful to matching physical wire payloads; expected ordinals/message indexes were checked against the unchanged actual production tokenizer/inventory. The delivered SQL test blob489835a63ca5071610699c59c1e3912968ffcd5e therefore differs from native test blobf3cd80b3855e40838a11cef2d39a360eb707a9c1 in those positive fixtures only. Assertions and migration unchanged. Ordinary CI must rerun all64cases on this exact delivery; the native receipt is not mislabeled as having tested this last fixture adjustment.

## Skill routing and remaining work

Receiving-code-review, false-positive verification, systematic debugging, test-first regression/mutation checks, differential source/generated-contract review, Supabase/Postgres ownership/JSON guidance and verification-before-completion apply. Isolated local worktree preserves the exported PR tree. No UI, deployment, hook installation or broad unrelated refactor. No independent approval is inferred from author tests.

Keep PR370 draft until corrected-head independent review and all substantive owners are complete. Next task: real per-object register/accepted-tenant/legal-party/business-acceptance decisions with immutable source/hash/original-scope/message/object/rule/reason bindings and linked corrections; only then temporal/supersession/E61/E62 selection. FullE035/F3/masterplan incomplete. PR310paused/untouched; accepted main stillPR369/eb2b8693; no hosted database writes, market messages or deployments.
