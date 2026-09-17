# F3-D — source-exact PRODAT RFF reference projection

Status: IMPLEMENTED_NOT_VERIFIED (publication/full dependency CI blocked).
Base: main `5a741b2c6e108d2db08b24aab9c0e6c4b71b1862`, tree
`4a2803344e5ba82db1091b5e6f4f2061bf330d7e`, after merged PR323.
No remote candidate/PR/merge exists for this work at this checkpoint.
PR310 is paused, unchanged and excluded.

## Independent source contract and reproduced defects

Use the unchanged original `docs/ediel/masterplan-v2/registers/prodat_fields.json`,
including embedded P26.A r3 §2.6 p46 and pp76–79 segment-table evidence. This is
not a claim to have independently reacquired or authenticated a new original PDF.
C506/1153 selects the reference; C506/1154 is its value. 1156 and4000 are separate
components, not suffixes of1154. Projection tests with those extra components do
not assert that the complete message is nationally permitted.

| Field | Source qualifier | Meaning |
| --- | --- | --- |
|315|XA|Sender organisation reference under header NAD FR|
|224|MG|Current meter number|
|225|Z02|Old meter number|
|308|VC|Supplier contract number|
|260|Z05|Network area|
|320|Z08|Calorific-value area (not an EL capability activation)|
|240|Z06|Serial ID (not an EL capability activation)|
|319|Z07|Related consumption point, not permission ID|
|261|ANJ|End-customer authorisation, not LI case reference|
|226|LI|Case reference|
|325|Z09|Permission ID|

The base used incorrect NAD/MG/CT/Z10/SI locators for315/225/308/320/240. Multiple
readers concatenated C506 metadata or split already decoded/released reference
values again. TGT261 preferred LI to ANJ; the new/old meter comparison looked for
duplicate MG instead of comparing MG to Z02. Customer staging could substitute
stale parsed values or borrow another object. Reference persistence could label
BGM as RFF_LI, LI as TN/IDE, and stale/object identities as permission evidence.
The final105-case source harness reproduces82 failures on the unmodified base;
23 cases already passed. It passes105/105 after the correction.

## One shared projection, not a second normative authority

`prodatReferenceFields.ts` derives descriptors from the corrected existing field
matrix. It reads wire-preserved C506 components using the existing tokenizer.
Header sender XA and line SG16 references remain distinct; first-message bounds,
NAD boundaries, and detached field probes are explicit. Empty references cannot
satisfy required values; forbidden empty/misplaced references remain visible.
All13 original R/D/O/- columns and existing parent/dependent rules are preserved.
No GAS scope, extra message type, tenant mandate or new external error code is
activated by adding an accurately described field projection.

Actual consumers changed: canonical AST/facts, PRODAT line parser, canonical and
rulebook facades, field presence/allowed-value checks, customer staging, permission
fact extraction, TGT comparison and meter classification, ACK error references,
legacy PRODAT ingress, transport envelope references, Z18 preflight, and the
existing business-reference index writer. Only explicit structured-only legacy
fallback is retained for RFF-derived values. A dangling-release message can remain
stored for syntax/quarantine review but cannot publish guessed RFF identities.
Non-PRODAT reference fallback behavior and SQL schema/privileges are unchanged.

Reference comparisons against selected synthetic test source values preserve
punctuation, leading zeroes and case; expected fixture bytes are not rewritten.
No bulk backfill of historical indexed references or stored messages is included.

## Executed evidence

- `scripts/test-ediel-prodat-reference-fields.cjs`:105 distinct source-module cases.
  Base23pass/82fail; corrected105pass under UTC, Europe/Stockholm, Pacific/Apia.
- Existing five source harnesses:334pass. Combined source invocation:439pass.
  Repeated timezone runs are not additional distinct cases.
- The harness loads actual local production source. Supabase is synthetic only
  at the declared message/reference/event boundary; onboarding and tenant-context
  mutation functions throw if reached. No live DB, customer mutation, SMTP or TGT
  portal action occurs. The three index-writer cases exercise createEdielMessage
  through that synthetic boundary, not real SQL transaction/permission behavior.
-17 changed/new TypeScript files parsed with Node stripTypeScriptTypes. This is
  syntax/transpilation only, NOT TypeScript typechecking.
- Immutable specification integrity:33 original files,121 rules,231 contracts.
  No original specification or coverage acceptance status changed.

## Required qualification before merge

21 actual-module Vitest consumer cases are added in
`__tests__/ediel-prodat-reference-consumers.test.ts`, covering staging, ingress,
ACK, preflight and reference-index persistence. They are NOT executed here.
Full application/script/test typecheck, full Vitest, lint, API/RBAC/security, build,
unchanged budgets and normal exact-head PR CI remain mandatory. The persistent
Ediel workflow adds both new harnesses without removing prior gates.
Local npm could not install uncached dependencies; the connector exposes only
read/search GitHub actions in this session. No remote push/PR/merge was performed.

## Review boundaries and continuation

This is a reference-PROJECTION implementation candidate, not all F3 or a formal
AT-GOV/TGT/live certificate. Complete NAD/BGM/DTM projections, register2+ overlays,
all110 dependent conditions, full UNSM grammar, outbound legacy writer reachability,
context/grant authorization and formal source/market acceptance remain separate.
In particular existing broad permission-candidate matching is not certified by
correctly decoding its RFF facts. No PR310 replay/schema/type work is accepted.

Skills applied: source/spec conformance, codebase acquisition, TDD, systematic
root-cause debugging, affected-consumer variant review and evidence-based completion.
Supabase safety reviewed; no live access or permission change. No independent
human/agent review is claimed. Source-only green is not final implementation approval.

The existing upstream main commit object was reconstructed from its returned
GitHub commit payload/signature and verified to hash to exact5a741b2c. The local
candidate is a real descendant of that commit, not of a synthetic archive root.
Only shallow-history metadata was created locally; no upstream history changed.
