# PR331 Z04:319 — fixture correction and fresh local qualification

Status: IMPLEMENTED_NOT_VERIFIED. New-head ordinary CI and substantive independent review are required before merge.

## Provenance and preserved failed attempts

Parent: acbab21f2b130b827d5e7ed258cf97aa730eeb33, tree a27af8e289ea311589b1ccc17423e1c2c3533ab6; actual main base e4df8b58 after accepted PR330. Code/test source tree for the following local runs: 6fce86fd3a52c3945aa90b78dd2ff4d1155d70a5. Subsequent differences are audit/memory only. Native publication must match the final tree; no synthetic local commit history is eligible for publication.

Initial ordinary head acbab21f was NOT green: Ediel35359947798, OPS35359947835 and FullE2E35359947823 failed; Browser35359947775 passed. OPS verify105648456972 and clean replay105648457517 passed, but quality105648457398 failed at the full test suite. These are distinct from main full-release failures tracked in issue332. The earlier source-only audit remains historical, not a claim that unexecuted Vitest had passed.

Fresh local reproduction of the two affected files on unchanged acbab source: 98 tests, 73 passed and25 failed (24 Z04 fixtures plus1 catalog fixture). This local count is not substituted for any CI report. With correction and one added negative control: 99/99 passed.

## Corrections — no production code or acceptance gate weakened

The new row fixtures lacked field213 QTY while explicitly claiming no UTILTS exception. Some send tests therefore stopped at the earlier register gate rather than the D condition being tested. They now carry a real QTY31 value/unit after each LIN. Source-bound evidence is rebuilt from that exact wire, with meterReadingsSentInUtilts:false unchanged. Every original D error/throw assertion, environment, override and malformed reference remains. Additional assertions require no prior blocking register error.

The existing complete-facts catalog fixture used subtype V for Z04, contrary to its new source-bound condition. It now supplies valid D for Z04, retaining F for Z06/Z09 and the original full-registry identity/no-undetermined assertions. An added negative control requires Z04:319 to remain undetermined for V even when all byCell flags are true. This catalog test does not certify the remaining103 numeric D cells.

## Dependency recovery and actual execution

Existing isolated dependency artifact10549052365 from run35349955805 was downloaded, not regenerated through a new privileged workflow. ZIP SHA256 ac7f9415abb7dab14a6cd5cd6d0415d17239399aa0469f21f401e51ace5e7508; inner node_modules archive3e44b34f59fcdc4a71d21d63bb81a26a72b1d2a41f07dbd98fde1123071cbe3d. All three manifest checks pass, and archived package-lock.json is byte-identical to this source (88f4f36c97b4896442c3ce9cb837ea7f93a0fee55e6b63b477421b33b4b73d6b). Transport is not a test certificate. No dependencies, lockfiles or workflows were changed by this correction.

Fresh Node22.16 execution on that source:
- Full application Vitest with V8 coverage:2594/2594 in238 files; includes91 Z04 cases and8 catalog cases, not additional counts.
- Standalone source:913/913 (62 new plus851 unchanged retained cases).
- Application, script and test TypeScript pass. The first concurrent application-typecheck process exited137/Killed; it was NOT counted as success. A separate unchanged-source retry completed exit0. No code was altered to address that process termination.
- Lint exit0 with0 errors/99 warnings; not warning-free.
- Specification integrity33 files/121 rules/231 contracts, RBAC, unchanged large-file/performance budgets, mechanical checks and quality Vitest pass.
- Unchanged coverage ratchet passes: lines35.60%, statements34.19%, branches27.11%, functions40.98%.
- No local build, browser, disposable database replay or live-production certification is claimed. Ordinary current-head CI must run those applicable gates.

Log/report hashes are in the companion JSON. Historical source harness red1pass/61fail, row-only44pass/18fail and final62/62 remain in the initial audit; they are not rewritten by the fixture correction.

## Review and boundaries

CodeRabbit static review5731951173 inspected exact acbab/treea27 and found no blocking production defect; it explicitly did not execute tests. New-head source/assertion rereview remains required for this correction. Generic skipped/success automatic review is not acceptance.

Six D cells accepted by merged330; Z04:319 remains one candidate until this PR is accepted. Other103 cells,10 parent groups and full masterplan/F3–F7/live TGT remain unverified by this unit. PR310 remains paused; issue332 retains the three full-main release failures (70/73), including14 unregistered migration inventory entries. No SQL/types/grants, live DB/storage, market communication, explicit deployment/settings change or historical checksum adoption. Authorized main merges may trigger existing automatic deployment.
