# Next actions

Active item: register overlays (GOV-02 / P-05), following merged PR327.

1. Cross-check locked P26.A §2.2 and annex2 against the original field and acceptance registers; record exact per-field first/additional-register requirements and source locators.
2. Trace fields314/258 and all line objects through actual parser/AST, matrix, builders and consumers. Establish source-backed positive/negative cases before implementation.
3. Complete that implementation unit, preserve existing gates, run normal exact-head CI, obtain substantive review and merge without overwriting newer work.
4. Then address the remaining P-03 true/false/unknown national dependent-condition outcomes, using per-note optional/forbidden semantics rather than a blanket rule.

No register runtime change has yet been published. PR310 remains paused. Full F3/F7/masterplan acceptance remains separate.
