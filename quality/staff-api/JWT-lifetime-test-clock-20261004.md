# Staff assertion lifetime test clock

Confirmed test fixture defect, not a production authorization defect.
S2 workflow 37200219138 quality job 111430198019 reported
`rejects signed lifetime_too_long before membership lookup` resolving instead of
rejecting. The complete log had three failures/9648 tests: this clock fixture and
two separate embedded SQL `\ir` loader failures already addressed by baseline
`0b81fa27305c2571e94c3fbe7aeecd8aa563d0df`.

The `it.each` table calculated `exp = collectionTime + 901`, while the signing
helper calculated `iat` later at test execution. A one-second collection-to-mint
delay produces `exp - iat = 900`, which the unchanged actual verifier correctly
accepts. Its 900-second maximum and 60-second clock-skew checks are unchanged.

The test-only signing helper now accepts a claims factory, supplying the same
single mint instant used for its default `iat`. The overlong fixture computes
`exp = issuedAt + 901` inside that factory. Existing invalid claim cases and
signature/issuer/audience/replay tests are retained.

| Verification | Result |
| --- | --- |
| Actual original context test with Date-only fake clock, collection 12:00:00.999 → mint 12:00:01.999 | RED: exact original lifetime assertion failed, 20 other tests passed |
| Same delayed run after fixture repair | GREEN: 23/23 passed |
| New actual-context controls after one- and 120-second mint delays | Signed lifetime 900 accepted; 901 rejected cold and after a successful request, before membership/JTI consumption |
| Normal context, shared assertion, assertion OpenAPI and staff HTTP suites | Three independent runs, each 53/53 passed |
| ESLint and targeted context-test TypeScript/transitive imports | Passed |
| Production context/shared verifier and all three generated artifacts | Byte-identical to baseline |

RED log: `/tmp/gridex-staff-jwt-clock-red.log`. Delayed GREEN log:
`/tmp/gridex-staff-jwt-clock-delayed-green.log`. Normal repeated logs:
`/tmp/gridex-staff-jwt-clock-targeted-{1,2,3}.log`.
Temporary reproduction setup/config were removed; the committed delay controls
restore the Date clock in `finally`. No production code, database migration,
schema, generated type, capture provenance or package worktree is changed.
This targeted proof does not claim fresh full quality/native CI success.
