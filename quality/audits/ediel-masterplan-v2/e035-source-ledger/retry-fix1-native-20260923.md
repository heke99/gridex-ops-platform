# Retry fix round1 actual native result

Published e9778f9db1a7baffb79272326b89c492e241ce80, exact tree
796370bc9a2375b1d05ff45055781c18c530ca80 (local reviewed cd5fc33c).
OPS35882250390, native107253391474: 114 PASS / 4 FAIL of118,
50.39s. New forward20260923150649 applied. Quality/build job107253391108
and tenant workflow35882250625 succeeded.

Passing new cases include full-processor changed quantity/timezone/resolution,
strict malformed/null contract probes, five ownership drifts, two controlled
concurrent ownership updates, mutated returned-contract rejection and ACLs.
The earlier boolean-helper failures now pass.

Four positive tests fail before the metering write at assertPlatformSchemaReady:
the actual downstream idempotent writer and E30 hourly, half-hourly and monthly
two-observation controls. Actual error reports RUNTIME_FUNCTION_MISSING for
canonical_onboard_customer_graph(jsonb), and RUNTIME_RLS_POLICY_MISSING for
website_customer_applications. Readiness migration_version20260813230000,
schema_fingerprint_verified=true. Diagnose actual catalog/readiness evidence;
do not mock or bypass the gate. Passing negative guards alone do not establish
that valid writes succeed.

Independent scoped review additionally confirms an Important new existing-row
billing idempotency gap: attribution and total are compared, but frozen
underlay_month, underlay_year and currency are not. Sole implementer resumed
fix round2 to reproduce and repair this with a new forward migration, together
with actual readiness diagnosis. Published migrations remain immutable.

Native failed before type/schema generation. Artifact10760354455 is log-only;
reported ZIP SHA25628fdea314bd0fedb947fc7194eb311cdedbdc75de9f715b36ccd26d6ff608b7e.
No task acceptance, whole-E035 approval or merge.
