# CI publication recovery — 2026-09-13

Status: IMPLEMENTED_NOT_VERIFIED. New hosted results are required.

## Evidence and scope

Base commit39b4e4f6bc368969082484a17a9a5490379cb8a5 is authored/committed by
github-actions[bot]. Its parent8e0e88ae introduced a one-time workflow that used
github.token to publish the two-file reviewed patch. The resulting PR runs,
including OPS34769044644, are action_required with no jobs. GitHub documents that
GITHUB_TOKEN-triggered pull_request synchronize events require approval:
https://docs.github.com/en/actions/concepts/security/github_token
https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/

The publication workflow is now spent: its exact-parent and exact-preimage checks
would reject another execution. Remove that write-capable one-time workflow and
the already-applied delivery patch. Both remain retrievable from Git history.
Publish this coherent cleanup through the user's connected GitHub identity,
not through another workflow using GITHUB_TOKEN. No approval/protection policy,
ordinary test, SQL assertion, historical source, type baseline or release gate is
removed or changed. Do not infer that any GitHub security hold is approved.

## Prepublication checks

Recovered source export64018125 from the supplied artifact, verified ZIP SHA256
2b6b16a1323730b5c6790e35bfb6651eec4837d0a16ecae343e89b61b07d2939 and tar SHA256
ae2ed7e0d436c42f3aacf5433f4fb6853584cef194a987d8493b2872c9b55ead.
Reconstructed the two changes in39b4e4f6 and matched their published postimages:
- scripts/canonical-user-rbac-repair-selftest.py:
  aba99617be1cf4e594b617e978f1e28cd18c75458cdce7b4d4f9e14faff87a1c
- .agent-memory/current-state.md:
  20d75383f7fd03ef1e667cdedb3c264dd1594c4bdf1b47328a62f395368dd083

python scripts/canonical-user-rbac-repair-selftest.py --selection-only: PASS,
including the real nine-scope constructor schedule and once-only dispatch.
The longer local membership selftest exceeded the tool limit; no fresh pass is
claimed for it. Native proof and full CI must be read back after publication.

## Next action

Read the new workflow state, verify latest-head native repair and residual tests,
then reconcile the seven source dispositions and ordinary replay lifecycle.
Generate accepted types only after approved reconstruction. No production SQL,
main merge or Vercel deployment is included in this recovery.
