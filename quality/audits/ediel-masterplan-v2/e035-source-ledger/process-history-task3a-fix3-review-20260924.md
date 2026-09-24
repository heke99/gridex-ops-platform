### Finding Verdicts

- **A — OpenSSL printed serial representation mismatch/truncation: ADDRESSED.** `lib/ediel/transport/index.part-1.ts:507-514,539-542` accepts complete decimal digits or explicitly prefixed hexadecimal, converts through BigInt, and captures the complete serialNumber line instead of a hexadecimal-looking prefix. Decimal 1234 therefore becomes 4D2 and a large 0x serial is preserved without Number precision loss. Unsupported complete values return null. Expected certificate normalization, matching policy, encryption, and fallback paths are unchanged in the diff. `__tests__/ediel-cms-recipient-serial.test.ts:6-26` exercises real certificate generation, encryption and inspection for both forms, rejects a different expected serial for each, rejects seven unsupported values, and checks precision beyond 2^53. The fix does not substitute a convenient one-digit serial.
- **B — Bulk fixture INSERT timed out before reader execution: ADDRESSED in source.** `scripts/ediel-correction-context-native.test.ts:741-755` replaces one 1000-row statement with twenty 50-row statements, retains canonical insertion/trigger behavior, and explicitly requires 1001 persisted outbound rows before checking the same scoped overflow and unrelated-point exclusion. Neither production reader limits nor SQL/test time budgets are raised. Genuine native execution must still prove that total fixture and reader execution fit their unchanged budgets; batching alone is not a runtime PASS.
- **C — Legitimate last-functioning-admin guard prevented fixture deactivation: ADDRESSED in source.** `scripts/ediel-correction-context-native.test.ts:824-841` adds a separate seeded active user to the target company as company_admin with a corresponding company role before deactivating the original membership. It verifies the backup's active membership/profile and confirmed, unbanned, undeleted user predicates, then verifies the target membership is inactive. No guard is disabled or bypassed, and the existing exact SQL authorization denial plus actual direct-send zero-provider/entry checks remain.

### New Breakage in the Fix Diff

- None confirmed. The runtime delta is limited to printed serial parsing; no migration, checksum, tenant guard, dispatch policy, or generated contract changes appear in the frozen fix diff.

### Out-of-Scope Observations

- None added.

### Verdict

- **SPEC: Approved for this scoped static fix review.** Findings A, B and C are addressed by the submitted changes.
- **QUALITY: Approved for this scoped static fix review.** Complete-value parsing and real-crypto rejection tests directly cover the representation defect; fixture changes preserve the actual security and reader boundaries.
- **Fix round: All findings addressed, no new Critical/Important breakage.** Native301 and expected ordinary full6072 remain unqualified pending genuine same-head CI. In particular, batching's total execution time and successful backup-admin fixture setup need that run.
- **Evidence boundary:** appended fix3 report names actual-crypto RED2/GREEN10, targeted34/4, helper4/91 collection, all three TypeScript checks and scoped lint; this review checked the claimed coverage against the test source without rerunning covering tests. Parent supplied prior genuine native298PASS/3FAIL301; it is not a PASS for the new head.
- **Review boundary:** frozen diff `954b0e06a456de26da9fce775e3a350905ec95e9..a78cd3c1b98f7e3df06b11e212b90e594bba6d1f`, original Task3a constraints and the three supplied fix3 findings only. No outside-code expansion, runtime edits, migration execution, tests or commits; only this permitted report artifact written.
