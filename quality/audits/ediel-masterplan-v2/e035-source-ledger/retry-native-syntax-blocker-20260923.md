# First retry native checkpoint — blocked before qualification

Published candidate32d441116db7a2d8051cf732e1d967bef4a98ea8,
OPS35875416652/native job107229927027 FAILED while applying
20260923135706_ediel_utilts_consumption_binding_v1.sql.
PostgreSQL reports syntax error at end of input, function ending line401,
body LINE44. Actual offending IF expression is file line392:

```sql
OR o->>'direction' IS DISTINCT FROM CASE WHEN o->>'readingType'='production' THEN 'production' ELSE 'consumption' END THEN RETURN false; END IF;
```

Read-only diagnosis proposes parentheses around the CASE operand. No fix has
been applied or natively verified. The migration transaction did not commit;
new native tests/type generation/schema snapshot were not reached. Artifact
10756148285 is log-only, reported ZIP SHA256
45ed4444c84513bf5f5aadb3a854e6d6b960238d5e19dfbc0daa35f9bb36d221.

The plan requires published migrations/checksums to remain immutable. A later
forward cannot repair an earlier unparsable migration during empty replay.
Root paused implementation and requests an explicit narrow exception to repair
this draft migration/checksum, after confirming it has not been applied in a
retained environment. No hosted migration-history check or global never-applied
claim is made here. No main/PR310/hosted/market writes.

The separate verify job107229926640 passed migration integrity602/506,
legal and hardening checks, then failed the expected stale generated-types
manifest tail. It is not the SQL failure above. No generated authority fabricated.

Published checkpoint local unit evidence remains5931/363 PASS and all3types.
Subsequent uncommitted ownership tests produced3FAIL/1PASS: billing writer
permits point.grid_owner_id, point.site_id or site.grid_owner_id drift. These
are remaining implementation findings, not accepted behavior; tests preserved,
production changes paused. Independent early checkpoint review also remains
pending. Full E035 and masterplan are not complete.
