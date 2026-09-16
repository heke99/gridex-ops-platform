# Two bounded UUID/inet source decisions

Status: locally verified; central/native integration is separate. No schema,
reference, original migration or acceptance-engine edits in this subtask.

Actual qualification run35013041767/job104529480330 was independently read from
GitHub logs. It passed three UUID/null and five normalized IPv4/IPv6/null cases,
seven 22P02 rejections, rollback/source preservation and owned cleanup. Its exact
receipt is pinned in uuid-inet-qualified-receipt.json. False metadata/FK/ACL/HTTP
and arbitrary-text acceptance fields are deliberately retained.

The retained original335f987f ZIP was independently hashed as
4009f365e8b7e255611992a12c031df159da2e16a4e46875af25593668d4aecb; its full-schema
member is483a086d05f357f44a46bf48e0464b771cf288dece12660185dafcebf9857a75.
Both changed-column records were read from that member, and all four full rows
were independently reconstructed from the audited ordinal/type/default/nullability
attributes and matched exactly. No hashes were manufactured from a new result.

- ediel_send_locks.locked_by: reference cde9d7aa86071568e6301304872d71a25a965631d96e179f7ae939d369727b45; replay 6d4f8121dc805842d207c7ae529df363eea62039cf3566c18acaa718c2c4b65d.
- integration_api_requests.ip_address: reference 3e60426aabc1fa4b030d93cc9fe7e34cf77ef3f8cff3dde8383692f99028797f; replay 708b0cee132f782a53b446b9dc28ae83b45b6ca3e0448d9001533731ea27b8c1.

Positive decisions preserve the first authored UUID actor and inet address
contracts already reviewed against their actual callers. The source module
requires exact current changed-column metadata rows, a complete native144/514/
forward receipt and all five original final SQL checks. The UUID decision also
requires the actual added validated auth.users FK row, reconstructed exactly as
FOREIGN KEY(locked_by) REFERENCES auth.users(id) ON DELETE SET NULL, digest
f2e539429731b0b19a74cede497f2eb84228171a52c4efe9135c2e044893be7a.
Missing, changed, duplicate or reclassified column/FK rows fail. This is more than
accepting an observed hash: the full metadata definition, positive source/caller
contract, real payload qualification and current native context are all required.

The existing portable residual helper contains unknown-user23503 and identity
preservation checks. The native foundation path executes the authored residual99
source but does not invoke that portable helper. Accordingly these new decisions
claim validated FK catalog enforcement only: they do not claim native unknown-user
or parent-delete execution. Those separate FK behavioral qualifications remain
required wherever broader FK acceptance needs them.

Inet output may canonicalize address text. Passing host(inet) for the bounded
fixtures does not establish general text-byte preservation, HTTP serialization
or equality for arbitrary payloads. All those claims remain explicitly false.
The strict independent normalized dump gate remains authoritative for catalog
properties outside the introspection row projection.

API for root integration: extend approved mappings with module.approved(), require
module.validate_context(diff) before schema acceptance, and use the existing
nativeFinalSql receipt. No new invented runtime summary is accepted. Five tests
pass, including exact evidence hashes, metadata/FK negative controls, incomplete
native/finalSQL rejection and retained false limits. Git diff check passes.
