# F3C-02 — numeric field inventory and next qualification

Date: 2026-09-20. Baseline: actual PR358 merge352fd8ee9129697b55c1d3796fb99ed04ca0d6f5, tree71342c9704fbaab3117172e7b63f38440a182727. This is a read-only inventory, not full field or phase acceptance.

## Observed identity and base-usage equality

A read-only Python probe compares the current literal descriptors in lib/ediel/prodat/prodat26AFieldMatrix.ts with the frozen register docs/ediel/masterplan-v2/registers/prodat_fields.json. It compares identifiers and the base thirteen-code requirement vectors only. It does not execute the runtime, assess values/qualifiers, validate full grammar, prove subtype/parent/register composition, or certify any live route.

Result:74 current numeric identities equal74 frozen identities;3 separately named parent descriptors;13 message codes;962 base-usage cells equal;0 missing IDs,0 extra IDs,0 usage differences. The exact probe and output are retained in field-inventory-20260920/. If source formatting changes, inspect the probe instead of assuming it is a general TypeScript parser. This is not a new acceptance counter and does not replace source-qualified behavioral evidence.

| Descriptor family | Numeric fields | Exact field identities |
|---|---:|---|
| BGM |4|202,203,204,313|
| CCI |19|214,215,217,218,219,306,307,220,222,223,259,254,242,506,310,513,322,323,324|
| DTM |12|205,206,210,211,302,321,216,212,249,508,326,327|
| FTX |2|301,303|
| LIN |3|314,209,258|
| NAD |20|207,208,227,228,229,231,232,316,233,234,235,236,237,250,251,252,253,317,318,262|
| QTY |1|213|
| RFF |11|315,224,225,308,260,320,240,319,261,226,325|
| UNB |1|311|
| UNH |1|312|

Parent descriptors:END_USER_GROUP,INSTALLATION_GROUP,INVOICEE_GROUP. These3 descriptors are not the10 accepted dependent parent occurrences. Field identity equality is not proof of register overlays or each presence/value/error path.

Run from repository root:

```sh
python3 quality/audits/ediel-masterplan-v2/field-inventory-20260920/probe.py .
```

Input SHA256 values:
- runtime matrix:a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382
- frozen register:e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354

Original probe SHA2568c1660ebd8fa36e1583c23c27ec9c9c5ee21ac05e24042209f71f1866bf16a50; original outputd02e69cbb0f6faa72bd58d786193b2c9046247c46d5aaa87c36dbb5cce5fd1d5. Root reproduced the output and verified the source tree before publication.

## Existing behavioral evidence is retained, not overstated

PR358's64-case UNB harness and final exact-head/source review concern bounded E011. A fresh run of the existing source-locator, characteristic, reference, document and party harnesses passed672/672 on the final identical source tree using localNode22.16.0. These suites cover their particular contracts; they are not a complete74-field/F3 certificate. Their earlier accepted audits and original REDs are not reopened by this inventory. The current ordinary main verification is separately recorded in pr358-main-acceptance-20260920.json.

## Next finite qualification candidate: FTX301/303

The frozen field register records301 as headerFTX[4451=AAI]/C108/4440[1..5], with P section2.2 p16 and section2.6 p44. It records303 as own-objectSG8/FTX[4451=ACB]/C108/4440, with P p18/p53. The frozen segment evidence describes five an..70 components and the first value mandatory if that segment is present. These are frozen-source locators, not a fresh original-PDF inspection in this continuation.

Current descriptors both use generic segmentPathFTX;301 explicitly has header scope,303 has the default object scope. The inspected fieldMatrix.fieldRulePresentInScope uses specialized owners for other families and a generic pathPresence fallback. This is a qualification target, NOT by itself a confirmed current behavioral defect. A later consumer may supply additional checks; trace it before concluding.

Before a new runtime fix:
1. Read original applicable P pages16/18/44/53 and the relevant precedence/applicability/grammar context; retain actual source/hash/page evidence rather than copying old conclusions.
2. Trace exact301/303 owners and consumers through field matrix, canonical/registry validation, parsing, rendering and typed ACK projection. Check prior receipts and existing dedicated tests first.
3. Specify independent positive and negative controls for AAI/ACB qualifiers, header versus own object, absent optional fields, component lengths/counts, first-value presence, released separators, repeated objects/registers, applicable versus unused incoming/outgoing behavior and exact error ownership. National usage is not generic syntax mandatory status. No new ERC/field mapping is invented.
4. Obtain source/design/oracle review of that finite record. Only a meaningful reproduced gap authorizes a bounded fix under the standing plan. Otherwise accept the existing evidence with its precise scope and continue to the next unresolved criterion.

No source/CI threshold, workflow, runtime, schema, role or provider changes are made by this inventory. Independent read-only fact-check5752706986 at exact merge352fd8ee confirmed the identity/base-usage inventory and recommended301/303 together. It did not certify their behavior or perform a fresh original-PDF inspection. Treat its generic-helper scope observation as a trace lead: outer scoped callers must still be examined before alleging cross-object behavior.

## Remaining phase boundary

D110/110+10/10 retain their historical acceptance. The bounded E011 acceptance does not prove all CONTRL grammar or all F3 responses. F3C-02/04/05/06/07 still need criterion-level reconciliation. FullF3/masterplan remain NOT_COMPLETE. PR310 stays paused ate961135199f292b8210884f07de3b616a670161a, without writes/import/restart/merge. No overall percentage or live/formal readiness is inferred.
