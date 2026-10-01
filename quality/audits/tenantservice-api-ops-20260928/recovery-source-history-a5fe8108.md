# Exact recovered local Git history

The terminal has no GitHub write credential; publication uses the already authorized GitHub connector. Its commit endpoint creates new server commit metadata, so the remote publication SHA differs from the original local commits even when the source tree is identical. Both published OPS/API parents remain in the remote ancestry; no force update or backup-ref movement is permitted.

This immutable incremental Git bundle preserves exact original local Git objects through `a5fe810824ef555a38a72e97e8e692e0690c1e9a`, including recovered source commit `620a57ed` and the original unpushed continuation at `da45651a`. It was created before this explanatory checkpoint and contains no future self-reference. Original checkouts remain unchanged.

- Bundle SHA256: `274ac9bdc84846470d5d505252a34a6766da753b9fc3d74305c9dd8f9b61997c`
- Bundle bytes: `483198`
- Tip tree: `90664996835465ae56a96cfc4f179ec77ea2c300`
- Prerequisites: existing commits `cc90678d`, `7afb3dca`, `a826b588`, `ae56ee0a`, available in the preserved published histories.

After fetching the existing published repository histories, `git bundle verify` validates prerequisites; `git fetch ./recovery-source-history-a5fe8108.bundle HEAD:refs/heads/recovered-local-a5fe8108` recovers the exact historical tip under a new local ref. Do not move the fixed remote backup branches. Runtime verification belongs to the recorded tested source/tree and actual CI, not the existence of this archive.
