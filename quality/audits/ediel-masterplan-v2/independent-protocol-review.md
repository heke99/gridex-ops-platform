# Independent protocol review

Scope: uncommitted protocol changes against baseline b9f732d2; no source edits by reviewer. Inspected canonical policy resolution, dependent engine, field validator and presence checks, PRODAT render gateway and profile renderer, ACK draft/body construction, canonical ACK gateway source metadata, runtime ACK validation, canonical parser/classifier, and inbound Z14 projection caller. Concurrent inbound/UTILTS changes were excluded.

Skills: code-review, differential-review, spec-to-code-compliance, fp-check, verification-before-completion. Database/RLS, UI/performance, deployment and supply-chain workflows were not triggered by this bounded review.

## Confirmed blockers at initial review

1. P1: U-APERAK draft for UTILTS_ERR fails its production validation path. `ack.ts` now stores E5SE5A, `kernel.ts:178` preserves canonicalSourceMessageFamily=UTILTS_ERR, but `validator.ts:192` accepts E5SE5A only for UTILTS. Executed draft -> validateRulebookMessage(mode=send, source family metadata) reproduces `canonical_ediel_version_not_allowed:APERAK:E5SE5A`. Extend the same profile predicate to runtime version validation; verify both ERR outcomes through that path.
2. P2: Stored message-code alias can leak into DOC. `classify.ts:68` and `messageParser.ts:155` represent ERR as UTILTS_ERR; new renderer profile copies source.messageCode directly into DOC. Executed classifier -> draft reproduces `DOC+UTILTS_ERR:SVK:260+ORIGINAL`. Normalize stored code alias to wire ERR, and test stored alias alongside raw ERR. This is a supported representation issue; ordinary email parser itself retains raw ERR.

Both sent to implementation agent for correction and independently verified resolved in the final review below.

## Parent validation assessment

UD and IT exclusion matches supplied prodat_parent_groups.json and masterplan sections 2.2/7.3. Filter applies only to canonical Z14/N and preserves other subtypes/codes. Inbound child checks are removed and outbound fields become forbidden, without modifying the immutable base matrix. Canonical policy derives normalized subtype before both consumers. No regression found in this bounded logic.

Initial construction concern: profileRenderer still built NAD UD/IT for Z14N and renderProdat validates dependent_only. This concern is now resolved by explicit parent checks in profileRenderer and a populated-context construction regression. Limits: complete valid Z14N acceptance, other D cells, downstream business projection ignoring extras, all parent applicability cases, multi-object/register validation, live delivery, certification and whole-masterplan acceptance are not established.

## Executed verification

- `node_modules/.bin/vitest run __tests__/ediel-masterplan-protocol-regression.test.ts __tests__/prodat-dependent-condition-engine.test.ts __tests__/utilts-aperak-contrl-central-engine.test.ts __tests__/ediel-canonical-ack.test.ts`: 4 files, 30 tests passed.
- Temporary independent regression probe: 2 tests passed, proving both blocker reproductions above. Probe excluded from permanent source; implementation agent asked to add lasting positive-path regressions.

## Final independent review — approved bounded changes

Re-read the final ACK renderer/validator and PRODAT profileRenderer diffs. The runtime ACK version gate now uses the same family predicate as draft/body selection; the DOC renderer translates the supported stored code alias to wire ERR. Permanent tests reproduce classifier-derived alias inputs through draft construction and runtime validation for both positive and negative APERAK. Parent construction now checks canonical subtype using the same bounded applicability helper; a populated Z14N context omits both parents while positive V retains both.

Independently executed five suites after these repairs: `node_modules/.bin/vitest run __tests__/ediel-masterplan-protocol-regression.test.ts __tests__/prodat-dependent-condition-engine.test.ts __tests__/utilts-aperak-contrl-central-engine.test.ts __tests__/ediel-canonical-ack.test.ts __tests__/prodat-26a-semantic-hardening.test.ts` — 47 tests passed. `git diff --check` passed. Temporary reproduction test deleted and absence verified. No blocker remains in the bounded reviewed changes. This approval does not cover DB-backed ACK creation/delivery, live certification, or complete masterplan implementation.
