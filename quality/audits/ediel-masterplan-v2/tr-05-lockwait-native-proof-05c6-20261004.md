# Independent row-lock proof review — PR503

Scope: read-only inspection of the final genuine worker row-lock case only.
Root owns TR05/TR10 implementation, native execution, coverage and publication.
No product/test/shared-memory/coverage edits are authorized by this review.

Frozen review head: `05c6e8b7e8a4399ec0e5e50358eb6d9e2231f72e`.
Frozen tree: `8c75872a750318fc90e45145116c99d4e42f5b93`.
TR05 file SHA256: `639baacf1530f9ad1bb9fea2f247bc4f19f6660bddc4ffec2c0146624c013fdb`.
Source: `/workspace/gridex-masterplan-retry/scripts/ediel-tr-05-recovery-native.test.ts`, final test at line421.
Workflow: `Ediel recovery native feedback`, actual run37239978374, job111546581471.
Genuine artifact11317501378 from run37239978374/job111546581471:
ZIP SHA256 `94fd879e312d78853dba28c65803d02b142a4a849f6b0d61c94c697dbd8e26e1` (root verified archive custody).
Receipt/JUnit inspected independently at `/tmp/masterplan503-native05`.
Receipt matches frozen head/tree and TR05 file hash above. Root verified all9 input hashes.
Row-lock outcome PASS: actual JUnit case6.90817373 seconds, failure0/error0/skip0.
The same artifact has28 cases,23 PASS/5 FAIL/0 ERROR/0 SKIP; no complete-card approval.

The original 0c526dea run37237701663 fixture failed57014 statement timeout
and one unhandled rejection, so it never proved post-lock provider refusal.
The new timing-only barrier forwards the original SDK entry request and result
after actual worker front-door/public writes/archive/private prepare. It never
substitutes an authorization result or inserts a private attempt.

Required asserting sequence: exact public claim receives a declared committed
two-second remaining lease; an owned local psql session locks that exact tuple;
pg_stat_activity identifies the actual transport RPC blocked while current;
the same claim remains blocked until explicit DB-clock expiry; COMMIT releases
the holder; actual SQL returns P0001 ediel_transport_worker_fence_lost; the
private prepared attempt remains byte-for-byte unchanged; entered attempts,
reconciliation cases and SMTP calls remain zero. 57014 cannot satisfy P0001.

The existing client gate sets entered=true before awaiting entry (lost-response
protection), so actual SQL refusal is conservatively public delivery_uncertain.
This public status alone is not proof. The actual SQL error and retained private
non-entry are mandatory assertions. No reconciliation case is justified.

Synthetic bounds: only local tenant/network/contract/POA/source inputs, explicit
public lease clock and owned row-lock timing; external SMTP is mocked. Genuine
PostgreSQL/PostgREST/storage/source owners must execute. This case does not
prove external issuer/SMTP/market acceptance, other lanes, or the whole card.

The asserting race now proves actual current→expired blocked lease and the
actual P0001 native fence refusal with private non-entry and zero SMTP. It
cannot pass on the former57014 timeout. No further race fixture edits needed.

Next: root/ten07 own remaining TR05 failures and required exact-head gates.
This independent bounded review is complete; no approval of other cases,
whole card, external market custody, upgrade/parity or future composition.
