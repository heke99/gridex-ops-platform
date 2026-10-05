# PR358 verification checkpoint — 2026-09-20

Controlling active state after interrupted implementation. Exact existing runtime commit3f6f1fc1db3938ab76185c34d344ae89393efa72; tree41a9df13d3b4cda604616727821567e8c34aa3ab; base/main5e3cb079cf2901be42964198d79b2ceab755f28f. This checkpoint changes documentation only over that candidate.

Authoritative sequence: corrected Task A at9d87d288 -> independent SOURCE/DESIGN/ORACLE PASS5752177628 -> recorded meaningful42-case RED5752201323 -> approved bounded execution amendments5752208557 -> published runtime3f6f1fc1. Original df1df8d source record's monitoring claim is superseded by f3-unb0031-task-a-review-correction-20260920.md. Do not treat historical PENDING text in frozen audit records as active instructions.

Existing runtime adds a required boolean acknowledgementRequest to shared envelope and alternate serializers, wires real canonical callers, fixes outgoing ACK requirement/status/due-time and source testFlag projection, and includes narrowly reviewed ERR process/no-ACK state convergence. Durable new harness scripts/test-ediel-unb-ack-request.cjs is run by __tests__/ediel-unb-ack-request.test.ts inside ordinary npm test. No green result is inferred merely from these files existing.

Observed ordinary PR checks on3f6f1fc1: action_required for runs35534161014,35534161016,35534161023,35534161017,35534161024; no accepted exact-head CI. Keep their receipts intact. Next: current-head ordinary checks and independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and whole-PR review; fix concrete failures, no bypass. Guarded merge and actual-main acceptance remain subsequent gates.

No E011/full-F3/masterplan acceptance yet. D110/110+parents10/10 and PR357 acceptance remain unchanged. PR310 remains paused ate9611351; no live operations. Restored local artifact10612410686 is the9d87 baseline, not current3f6f; any fresh local test must first recover the exact current tree.
