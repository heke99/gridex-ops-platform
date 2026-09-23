# Ediel operational-case initial review and CI

Candidate: `d1e14fc75c90a83d66e31b2c2d72c906b7637f14`, identical implementation tree to local `482759722124835aa74f9e082696fd77109010d8`.

Independent task review: SPEC issues; QUALITY needs fixes. Important findings: the exact open-case card led to an unfiltered latest-200 history window; the status selector omitted existing billing_blocked/cancelled values and could implicitly select open; native verification lacked explicit ACK state/record non-mutation assertions. Existing company/source guards, permission-qualified links and atomic expected-source update were positively reviewed. Browser qualification remained pending.

Actual OPS run `35890710047`:

- Verify job `107282144220`: migration check passed; service-role ratchet failed at 2403 against unchanged 2402 baseline.
- Quality job `107282144965`: lint, script/test types, mechanical gates and all 5952 tests in 368 files passed. RBAC audit rejected unreviewed supabaseService usage in the new operational-cases page. Build was not reached in this job.
- Native job `107282144593`: existing 124 native tests passed. New case fixture failed before browser launch: createActor expected communication.read but actual resolved permission array was empty. Authorized/selected-company assertions preceded this failure. This is not browser qualification.
- Replay artifact `10764503359`, ZIP SHA256 `31bbb7a42a1d62a9218652ddf396446e4f6aa0acee357167bead3c934b844ff1` contains the failed run evidence; it is not a completed generated schema/type receipt.

All findings were delivered to the sole implementer for coherent fix round 1. No baseline increase, permission bypass or business authority widening is authorized. Re-review and actual same-candidate native/browser execution remain required. Successful-retry qualification at fe63dd98 remains separately complete; whole E035 is not accepted or merged.

Other terminal gates: Ediel run35890709811 and public browser35890710024 passed (the latter is not the protected local case test). Coverage107282145205 passed. Full-E2E smoke107282144801 failed only its RBAC check (14/15 passed), so its PR certificate failed. Tenant run35890709832 failed the same service-role ratchet. No additional production defect is inferred from these duplicate gate failures.

Independent reviewer clarified that filtering statuses before the limit addresses resolved-row displacement but not discovery of more than200 open cases. Fix round1 must include bounded exception pagination with matching source/status predicates and deterministic order; exact aggregate and exact-ID retrieval remain separate.
