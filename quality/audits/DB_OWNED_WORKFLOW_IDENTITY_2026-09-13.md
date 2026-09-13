# Owned replay workflow identity correction

Status: IMPLEMENTED_NOT_VERIFIED (fresh native result pending).
Base:1f09dcc770215f1a64b895c2172bf7eec5fa2032, PR310.

## Publication recovered

Run34778566213/job103781251085 applied and tested the exact reviewed tree
1ace7a02ab3e5e8e54e0abb385b9a5f9b2b08f14, but push was refused because the
workflow token lacked workflows permission. The same patch/archive/tree hashes
were verified locally.127 focused tests passed locally before publication.
Commit1f09dcc was created with that exact tree and parent042f05a, then the existing
PR branch was fast-forwarded through the connected GitHub API and read back.
No force push, main merge, permission change or production mutation occurred.
A subsequent local38-test legacy accounting invocation timed out: no local pass
is claimed for that invocation. The publisher's complete hosted38-test run passed.

## Observed failure and minimal correction

Fresh run34778949144/job103782281962 passed cleanup and canonical-source
admission, then rejected owned preparation before migration SQL. Cleanup passed.
The workflow name gridex-auth-legacy-ordinary-34778949144-1 is not admitted by
the unchanged AcceptedInputs identity contract. A regression test reproduces
FRESH_FIXED_PREPARATION_REQUIRED on that same identity. The workflow now uses
the existing continuation family with numeric run/attempt suffixes.

Three tests call the actual private-input constructor with only the live-handle
prerequisite mocked: configured workflow identity accepted; old identity rejected
before source reads; replaced private method rejected before source reads. Exact
source hashes and method identity checks remain active.3 new plus13 existing
tail and18 source-admission tests pass locally. No native local SQL is claimed.
Both workflow jobs run the new test; its path is included in the trigger filter.

## Unchanged boundaries

No historical migration, runtime product/API code, source-disposition manifest,
SQL guard, fingerprint, generated type or accepted-schema manifest is changed.
Canonical sources accounted600 does not mean complete database acceptance.
The managed clean-replay/type release job remains mandatory and unresolved.
Read fresh native results before marking this correction verified. Points85/86,
ledger provenance and accepted type regeneration remain incomplete.
