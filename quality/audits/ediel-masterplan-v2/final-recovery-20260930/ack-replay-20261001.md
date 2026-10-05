# Outbound ACK protected replay packet

Base: `852b03dcb1e4ff384543a0d31aeb18b086745bf7`; isolated branch `codex/ediel-ack-replay-20261001`. Original publishers, references and dirty files were not changed.

The canonical gateway reads `ediel_read_outbound_ack_replay_v1` before fresh routing/guide selection and reuses the same port for a unique INSERT race. The RPC locks the current actor permission graph and tenant/transport namespace, reads the actual scoped inbound original and own outbound response, verifies immutable private source/ACK receipts, consumed owner/common witness, original bytes, source-generated ACK guide and physical reversed legal/transport/reference/sequence identity. It includes opposite outcomes and returns a wire-qualified outcome. Unattributed CONTRL obtains tenant scope from the protected actual technical source endpoint. Replay and conflicting-outcome refusal append no event, message, witness or outbox row.

CLI-created forward migration: `supabase migration new ediel_outbound_ack_protected_replay`, Supabase CLI `2.118.0`, file `20260930224443_ediel_outbound_ack_protected_replay.sql`. No hosted migration was run.

| Check | Actual result and limit |
| --- | --- |
| Red on base kernel | 14/14 new gateway probes fail, including changed raw/code/family, revoked native grant, malformed duplicate scope, full IDE and no-effect assertions. Baseline was loaded from `git show HEAD:lib/ediel/core/kernel.ts` only in this isolated worktree and restored. |
| Green gateway | Node 22 Vitest: 36/36 in new protected replay and converted canonical source gateway tests. These are explicitly mechanical consumer tests. |
| Focused SQL | PGlite runs real forward common-header/technical/native ACK guide/physical namespace/current permission resolver/replay SQL: 11 new checks, 38 total with enclosing source fixture. Covers current direct grant, membership, banned user, legal namespace revocation/collision, own outcome, scope, actual service-role RPC and no additional row counts. Synthetic boundary schema/transport adapter and a SHA-256 pgcrypto API bridge are declared. This is not native or full migration replay proof. |
| Native fixture | Added `scripts/ediel-outbound-ack-replay-native.test.ts`, with actual Supabase HTTP/RPC, canonical syntax decision, committed protected source facet, real ACK INSERT triggers/namespace, gateway replay, changed source, opposite outcome, and native grant/membership/endpoint revocation checks. Not locally executed: this container has no owned Docker/local Supabase capability. Mandatory CI must include and execute it on the final frozen candidate. |
| Typecheck | Local full TypeScript run exhausted the Node default 2 GiB heap, exit 134. No completed typecheck is claimed. Final integrated CI/type generation remains required. |

Replay is complete only for privately qualified own responses. No old public row is retroactively blessed; missing private basis is held. The current fresh ordinary/common owner pipeline prepares its one-use witness in a separate RPC before INSERT. A concurrent fresh creator can therefore leave an unconsumed witness on INSERT failure. This is an internal atomicity gap to close in a follow-up native mint-plus-INSERT command; it is not an external blocker and is not covered by the read-only replay claim.

Green focused checks do not accept masterplan v2 or any of the 352 original requirements by themselves.
