# Profile action normalization source restoration

The full 20260520_user_profiles_auth_action_constraint_hardfix.sql source was
UNCLASSIFIED. It normalizes last_auth_email_action and replaces its CHECK with
a maximum 120-character lowercase metadata grammar. It does not change user
roles, account status, credentials or tenant ownership. Unlike schema-only
sources it contains UPDATE statements, so trigger context was reviewed first.

Selected foundation boundary: immediately after the user_profiles bootstrap.
No earlier selected foundation references user_profiles. That bootstrap creates
no application function/trigger. Therefore the normalization at this reviewed
rebuild point has no application trigger side effects. This does not authorize
running the historical repair on a populated production schema with later triggers.

PGlite 0.3.14 tests execute actual profile table/ALTER/index DDL (extension setup
is outside this fixture) and the entire unmodified normalization source twice.
One case uses valid original values, another models legacy data after removing
the old CHECK in the fixture only. Whitespace becomes NULL, punctuation/case is
normalized and long values are truncated to 120 characters. Exact remaining row
fields are compared: identity, email, status and timestamps remain unchanged.
Invalid new values are rejected; valid custom metadata is accepted; both auth
foreign keys remain. Source-selection and boundary/trigger-review regressions
were red before and green after restoration.

29 accounting tests, static provenance and 587-file integrity pass. Accounting:
503 full selected, 29 partial, 51 unknown, four exclusions. Hosted SQL is pending
publication. No production write, historical checksum edit or phase closure.

Next reviewed dependency: 20260519_auth_callback_email_reset_sync.sql is still
partially substituted. Its omitted auth_email_events table/policy/indexes and
auth.users backfill require complete PostgreSQL17 execution with pgcrypto and
actual auth.role() semantics. It must precede the profile normalization if
restored, otherwise it reinstates the older narrower metadata CHECK. Current
adjacency assertions must be updated only with the verified combined chain.
