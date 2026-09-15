# PR310 native timestamp clone identity — 2026-09-15

Status: IMPLEMENTED_NOT_NATIVE_VERIFIED. Publication base61d6748e; preserves concurrent82cb5d00 stdin transport and
61d6748e complete foundation admission.

Ordinary run34963346262/job104361913858 on335f987f completed all144 foundation
inputs and timestamp1–7 with actual CLI statements/unchanged earlier ledger.
Its timestamp8 receipt contains the CLI file and statement hash before the first
restoration clone, with errorType JSONDecodeError. Diagnostic artifact10394374227
ZIP SHA2569c14aab272826678adf7bc4f3b3dfed9f1d99f36eb9246fac275694eced90112
was downloaded and verified. Ordinary artifact10395480303 is independently linked
by its job log. Native source8 itself applied; its source-specific positive and
negative restoration checks have not both completed, so accepted boundary stays7.

The absent-clone query SELECT to_json((SELECT oid::text ...)) returns SQL NULL.
Unaligned psql emits an empty field, whereas the old fake emitted JSON null.
Correct the SQL to COALESCE(..., 'null'::json), retaining fail-closed JSON parsing,
fixed container target, exact clone allowlist, OID checks and no deletion of
preexisting databases. No source SQL/ledger/authorization modification occurs.

RED: faithful empty-field transport reproduces5 JSONDecodeErrors. GREEN: native
proof16/16 and runtime12/12 pass. Composite FK offline4/4 pass. Their separate
source-derived behavior fixture is wired after existing inline-FK qualification
in the same isolated PostgreSQL17 service. Native execution is still required.

On f5a5fa88 verify104364493403 both inventory/recovery and isolated SQL fixtures
pass. The remaining migration check is the genuine generated-types tail guard;
it remains unchanged pending accepted complete schema and CLI type generation.
Schema reference is retained; four column type dispositions and seven composite
FK investigation are in their separate audits. No full schema acceptance,
production mutation, merge or genuine complete-schema type generation claimed.

Independent review found no issue in clone NULL fix or composite CI wiring.
Concurrent upstream changes merged without replacing source or proof code.
