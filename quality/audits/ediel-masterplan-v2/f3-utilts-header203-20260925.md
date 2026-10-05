# F3C-05: UTILTS document identifier, field 203

2026-09-25. Annex C, UG-122-7 requires nonblank BGM/C106/1004 and uniqueness over time; duplicate identity uses ERC 42. The retained `fieldMatrix.ts` header rule marks 203 required, and `utiltsFieldMatrix.ts` records the same requirement for the current normal/request codes.

The actual owner is the shared final header guide in `utiltsEngine.ts`; the received-message consumer is `processInboundUtiltsMessage`. A complete E66 with blank BGM/1004 and a genuine E19 mismatch previously finished as `functional_rejected`/UTILTS-ERR. Focused RED reproduced that observable result. The guide now projects a missing identifier as field 203/ERC 41, removes ineligible functional findings, and produces negative APERAK with FTX 203. A valid document identifier preserves E19. The actual inbound processor, with only external DB/sinks mocked, passes `guide_rejected` to the tenant-bound persistence RPC, sends APERAK only, and neither ingests meter/billing effects nor completes a request. The persistence implementation excludes business series for guide-rejected transactions.

This batch checks presence only. The source also requires uniqueness over time with ERC 42; no proven tenant-scoped inbound duplicate identity owner was found in this bounded trace. That rule remains open and must not be inferred from outbound draft `duplicateCheck` or transaction-ID persistence. An absent identifier stays fail-closed.

Local RED: `functional_rejected` for blank 203 + E19. GREEN: 29/29 focused runtime/processor tests, 313/313 across 25 relevant test files, app and test typechecks, scoped ESLint and diff check. Exact-head ordinary CI is required after publication. No staging, native mixed-IDE claim, market send or PR #310 change.
