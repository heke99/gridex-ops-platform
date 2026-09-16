# Preserve source-authored PUBLIC policies while removing exact24 inert policies

Status: actual owned qualification passed; revised unapplied tenth source registered; full replay pending.

Actual full replay35007022147/job104509232033 fails at forward10 with SQLSTATE
55000. The isolated original qualification had passed. A later full replay's
private error projection remains UNCLASSIFIED; no privacy exemption is introduced.

Source inspection identifies a concrete difference in the original fixture: it
omitted six preexisting PUBLIC platform policies. The May28 source's complete RLS
DO block creates platform_select and platform_write policies on each of
inbound_ediel_match_attempts, inbound_ediel_parse_results and
inbound_email_attachments. September4 convergence drops only their service_role
policies and retains these six. The canonical schema contains all six unchanged.
The original forward10 rejects every PUBLIC policy; therefore its isolated fixture
was not representative of this source-defined preimage.

Source authority:

- 20260528_batch_7a_route_inbound_mail_platform_ui.sql SHA256 a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690.
- Exact original DO block SHA256 f0b3fe093f519b2564674a89ce5bd6704a76a75bf408904228022dc593216368.
- 20260904120000_canonical_tenant_invariant_convergence.sql SHA256 3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1.

The revised fixture executes that entire original DO block against the three
existing target tables, then the three exact September service-policy DROP
statements. It runs the exact original candidate bytes, SHA256
b04ce7766f0d3e4655778cdd6aa6fcde1bb3a0661867e381aa0939f015c9e2c1,
and requires55000 with the complete snapshot unchanged. This actual reproduction
must pass before the revised candidate can qualify.

The revised candidate retains the original24 exact removal identities/hashes,
requires every one of the six PUBLIC policies with exact command, permissiveness,
role set, USING and WITH CHECK hashes, and adds only their exact identities to the
unexpected-policy allowlist. It requires all six even on a repeat invocation.
Unknown policy names or altered definitions remain rejected. The original client
table/column ACL closure is unchanged; no privilege is granted and no new policy
is created by the candidate. Snapshot comparison allows only the24 target policies
and their exact captured dependency keys to disappear. All six retained policies,
other dependencies, ACLs and business rows must remain unchanged.

Candidate: scripts/sql/forward-candidates/drop-inert-inbound-client-policies-preserve-platform.sql.
SHA256:5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7.

Separate unselected candidate postcondition:
scripts/sql/forward-candidates/inert-inbound-preserved-platform-postcondition.sql.
SHA256:baaa1053792c8e0d850fcde912b85a3561386756d4f7eec8d8b402591ce13c80.
It requires24 absent, six exact PUBLIC policy shapes, no unexpected client/PUBLIC
policy, and unchanged closed client/open service ACLs. Function visibility controls
the exact expected pg_get_expr qualification without accepting another function.
The selected migration and selected native assertion10 remain untouched here.

Qualification exercises29 candidate negative shapes and22 additional postcondition
negative shapes after24 have been removed. The latter prevents a false predicate
result from proving only that the24 removable policies were initially present.
The original candidate rejection, red24-to-green0, exact snapshot delta, repeat,
client denial, NOBYPASSRLS service CRUD and private cleanup remain required. Helpers
are signature fixtures; no application authorization behavior is certified.

Local test-canonical-inert-inbound-policy.py:7 tests PASS; selection-only PASS.
Owned SQL execution and genuine CLI creation are pending. The workflow requires a
fresh actual CLI filename later than the failed, unapplied September15 18:14:48
candidate, exact qualified bytes, and all revised proof fields. Original601 and
first9 migration bytes are unchanged. No schema/type/release acceptance is claimed.

Skill routing: systematic debugging, source comparison and verification before
completion apply. This is a bounded source-preimage correction; no UI/performance
work or production database action is in scope.

## Actual qualification and supersession

Owned PostgreSQL qualification35008661212/job104514750830 on sourceHead
ac7d19d581b648792e29cfb22799e169ed43602a passed every required control described
above, including the old candidate55000 reproduction,29 negative candidate shapes
and22 postcondition negatives. Genuine CLI2.101.0 created
20260915183840_drop_inert_inbound_client_policies.sql with exact candidate SHA256
5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7.
The new unpublished selected tenth source replaces only the failed, unapplied
18:14:48 candidate. Old candidate bytes remain archived outside migrations.
Native assertion10 now exactly matches the qualified postcondition bytes except
terminal newline. No full native replay or schema acceptance is implied.
