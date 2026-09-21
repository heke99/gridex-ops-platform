# Current state — PR364 implemented, final acceptance pending

Last accepted main34eb943046ab87761b071bc508ea48b7af70eea9/PR363 is verified with fresh73/73,5102unit tests and allOPS; pr363-main-acceptance-20260921.json, root5759348778. PR361/363 observation input and handoff are retained, not reopened.

Active PR364 normalizes only internal staging company scope, returns no match before any masterdata read when unresolved, and makes scoped matching filters mandatory. Original51 tests plus all5102 pre-existing tests are unchanged. Design5759320966 and observed ordinary27-failure RED5759395557 justify the bounded code. Status IMPLEMENTED_NOT_VERIFIED until exact-headCI, completed independent review, guarded merge and actual-main73/OPS.

Read current-task.md, checkpoint.json, handover.md and e035-prodat-staging-tenant-implementation-20260921.md. This lower-level contract defect has a normal outer tenant-resolution mitigation; no live-mail bypass asserted. FullE035/F3/masterplan remain incomplete; D110/110+10/10 retained. PR310paused/untouched, PR362closedunmerged; no live operations.
