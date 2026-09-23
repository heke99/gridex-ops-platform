# Legacy review case types — bounded task review

Base `805f5fbb3ee3f7938cba99695c98b0cafbef3b5b`; head `020b25ff42325ff1a69358c77b4ca7d343b63418`. Scope is the case-type repair in `020b25ff`; the intervening closure and sender-design documentation commits in the supplied package are not a second implementation under review. Skill routing: task-reviewer prompt and repository code-review/differential-review guidance govern this bounded spec/quality review; the repository-wide audit, UI redesign, database migration, security scan and implementation/fix workflows are not triggered. Read-only inspection; no suite was repeated.

## Spec Compliance

- ✅ **Spec compliant for the bounded persistence repair.** The four invalid producer literals become CHECK-valid `other`, with distinct typed intent retained in `reason_category` and `metadata.review_intent` (`lib/ediel/flows/inboundBusinessStateMachineLegacy.ts:261-289, 462-478, 509-537`). The canonical CHECK includes `other` and the retained rejection categories but excludes the four former literals (`supabase/schema.sql:55177`); this diff adds no CHECK/schema migration. The Z05C ambiguity still does not reopen a supply row (`inboundBusinessStateMachineLegacy.ts:220-254, 462-478`), and Z06/Z10 and unexpected-direction branches only create review cases (`:509-537`). Existing Z05L/LK closure and three rejection categories remain separate (`:444-459, 540-550`). Company/customer/site/point/switch/source/title/next action and original payload metadata continue through the shared writer (`:268-289`). No changed code makes case persistence an owner, availability, original-review or safe-apply decision.
- ✅ **Reproduction and coverage are meaningful, with a qualification limit.** The schema-correct fake now rejects all out-of-CHECK `case_type` values (`__tests__/ediel-closure-legacy-case.test.ts:4-16`). The four branch tests assert one case write, tenant/site/point/source/intent and no unintended supply write (`:40-60`); rejection tests retain the supported categories (`:61-64`). Native Z06/E64, Z06/E32 and Z10/E58 assertions query actual persisted row fields *before* explicit original review and check source disposition still unavailable (`scripts/ediel-source-owner-native.test.ts:281-299`). The implementer reports four focused RED CHECK failures, 11/11 GREEN, full 5913/360 and app/tests/scripts typechecks and focused lint passing; these results were not rerun by this reviewer.
- ⚠️ **Native acceptance reserved.** The newly added real PostgreSQL/HTTP persistence assertions at `scripts/ediel-source-owner-native.test.ts:284-299` have not executed on this head. The prior 62 native PASS belongs to the base closure slice, not these assertions. Exact-head native execution and ordinary delivery checks remain required before the controller calls the persisted-case integration qualified.
- ⚠️ **Operator navigation is a real downstream acceptance gap, not a proven authorization of this task.** `app/admin/controltower/page.tsx:90-103, 122, 135` counts/open-lists these cases and displays `reason_category`, but links both count and row to `/admin/customer-cases`. That page fetches at most 200 then retains only `support_case`/`tenant_support_` sources (`app/admin/customer-cases/page.tsx:10-12, 19-27, 60-64`); this writer uses `ediel_inbound_state_machine` (`inboundBusinessStateMachineLegacy.ts:281`). Thus a case may appear among the latest eight signals yet disappears at the destination, and older cases have no navigable row there. The brief asked to trace consumers/queue/UI and repair case-type persistence, not to broaden the tenant-support list; this is not silently accepted as a working internal-review queue. The controller should assign a separately scoped, permission-aware operator route before claiming actionable case review or whole-E035 completion, while retaining the support-only customer boundary.

## Strengths

- The writer's type union confines category choices to exactly the CHECK-valid values it uses and intents to named branch purposes (`inboundBusinessStateMachineLegacy.ts:257-266`), without a cast or CHECK widening.
- Tests reproduce the database constraint failure instead of making arbitrary mocked case values succeed; the field-level assertions catch regression of the previously repaired `site_id` and source binding (`__tests__/ediel-closure-legacy-case.test.ts:4-16, 40-60`).
- Native tests assert both case persistence and the independent source-unavailable-before-review boundary using real fixtures (`scripts/ediel-source-owner-native.test.ts:281-299`).

## Issues

### Critical (Must Fix)

- None confirmed in this task diff.

### Important (Should Fix)

- No confirmed task-scope production defect. The Control Tower/support-list mismatch above is a substantive separate integration gate, not evidence that the category repair should weaken support visibility or grant lifecycle/source authority (`app/admin/controltower/page.tsx:122,135`; `app/admin/customer-cases/page.tsx:10-12,26`).

### Minor (Nice to Have)

- None.

## Assessment

**Task quality: Approved for the bounded code change; native persistence qualification pending.** The four category mappings are explicit and the focused tests cover the failure and retained semantics. This verdict does not accept a navigable operator workflow, the unexecuted native additions, or whole-E035 authority.

