# Active task — unresolved PRODAT staging tenant boundary

PR363 is already merged and actual-main verified at34eb943046ab87761b071bc508ea48b7af70eea9: full73/73,5102tests,allOPS; pr363-main-acceptance-20260921.json saved. Do not redo361/363. Current work is test-first on codex/ediel-prodat-unresolved-matching-20260921.

Read e035-prodat-staging-tenant-plan-20260921.md. Existing PRODAT staging already preserves parsed registers; do not add duplicate diagnostic fields from limited reconnaissance5759151611. The exported staging function permits null company but its matcher currently performs unscoped service-role masterdata reads. The normal inbound flow has an outer unresolved-tenant stop; no live exploit is claimed. Preserve that gate and unresolved pending staging, but require no masterdata lookup/foreign links without a company and mandatory filters when scoped.

NEXT: independent bounded design/oracle review plus actual ordinary RED for51 new public-staging tests. Then minimal guarded matcher/scoped filters, unchanged tests, exact-headCI and completed review; guardedmerge and actualmain73/OPS receipt. FullE035/F3/masterplanNOT_COMPLETE. D110/110+10/10 retained; PR310paused e9611351 untouched; no liveoperations.
