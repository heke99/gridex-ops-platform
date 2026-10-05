# F3C-05: UTILTS BGM document agency, field 202

2026-09-25. Annex C UG-122-6 requires BGM/C002/3055 = `260`. The retained `fieldMatrix.ts` owns the BGM document-name header field 202, but its code-list entry did not project this composite agency rule into the final UTILTS decision. The real received-message consumer is `processInboundUtiltsMessage`.

A complete E66 with genuine E19 and only BGM/C002/3055 changed to missing/999 previously finished as functional rejection/UTILTS-ERR. Focused RED established the observable gap. The shared final header guide now uses the declared UNA tokenization, returns field 202/ERC 41 for missing or ERC 42 for invalid agency, removes ineligible E19 and plans negative APERAK/FTX202. The existing `260` control still produces E19. The actual inbound processor with only external DB/sinks mocked passes guide rejection to the tenant-bound persistence RPC, sends only APERAK, and performs no meter, billing or request-completion effect. The SQL persistence owner excludes business series for nonaccepted dispositions.

This batch covers only C002/3055. The same annex has conditional C002/1131 = `SVK` for S01–S07, and C002/1001 code-list rules. Those remain separate source/consumer traces, along with field203 uniqueness-over-time/ERC42. No native persisted mixed-IDE claim is made.

Local RED: `functional_rejected` for blank agency + real E19. GREEN: 315/315 relevant tests in 25 files, app/test typechecks, scoped ESLint, diff and memory checks. Exact-head ordinary CI is required after publication. No staging, hosted tests or market send.
