# Retained F/G fixture input and first-apply observation proposal

Status: UNAPPLIED, REVIEW REQUIRED, NOT_RUN. No coverage or machine-tag approval.

Prepared by z06_memory_native_map within the parent's exclusive F/G audit folder. Source owner remains #503. Allocation supplied by parent: #503 comment 5995812046 permits optional physical raw transformation before genuine capture/validation and deferred first apply/pre-apply observation, preserving existing defaults and all admission, validation, review and ACK owners. This artifact does not apply that allocation to shared source.

## Exact baseline and patch

Only proposed target: scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts.

| Item | Frozen identity |
| --- | --- |
| Retained published owner baseline, reported by parent | 5be3a902a61309e295d1f3b82f5ceb0996edb1dd |
| Local HEAD when proposal was prepared | 9ee912c143430438c34cb2aa46548cf02604e72c |
| Exact target Git blob, rechecked locally | 05eb94364ebac1e27b72773495a4b2baeead09c6 |
| Target SHA256 | 2ab4a02d257602504f790153cd45ef77972acbb73f77a5a0c4fb8d58faea9194 |
| Patch file | retained-fixture-input-defer.patch |
| Patch SHA256 | b705390993dcb28fe9cf3fecdbaae52e6f17bfdeb7b70e995db0381a9d7c5da8 |
| Proposed target Git blob, computed in memory only | bdc078bbae5f52955c1e2a7544babeb92bf41c41 |
| Proposed target SHA256, computed in memory only | 65e2b6c559e187d864ece902ade76e49fe25dcea31ee9c20d4c08058c75cbdf1 |

The exact target identity is unchanged across these different heads. No proposed target file was installed or written. The patch contains only one target. Its preparer ran git apply --check against the unchanged local target (exit0); root independently ran the same dry check at 14:16:24 UTC (exit0). Both are dry applicability checks, not test, native or implementation receipts. No further duplicate applicability check is needed for the unchanged b705 patch.

## Proposed interface

    export type Z06fNativeChangeOptions = {
      transformRaw?: (raw: string) => string
      deferFirstApply?: boolean
      beforeFirstApply?: (original: Readonly<EdielMessageRow>) => void | Promise<void>
    }

    change(kind = 'F', document = existingRandomDocument, options = {})
      -> Promise<{ message, apply }>

The actual patch follows the existing helper's compact formatting. No fixture method, capture export, direction option, public-fact override, expected-decision knob or alternate resolver is added.

With no options, the exact existing generated wire is passed to the unchanged stamping/capture path. Validation, rule evidence, owner completion, structural review and the existing appliedCount:1 assertion retain their order. No optional callback await occurs unless a callback is supplied. Existing return values and reading/read/snapshots methods remain unchanged.

With transformRaw, the synchronous callback sees the existing physical F/G wire. Its returned bytes undergo count-only UNT repair, then the unchanged stampTest, public synthetic capture, actual clock_timestamp admission, actual canonical runtime and all existing hard accepted assertions. This is an input transformation, not source approval. A callback failure or malformed message stops before capture; canonical/owner rejection is not converted into acceptance or a passing negative case.

With beforeFirstApply, the callback is awaited after genuine canonical validation, rule evidence capture, owner completion and structural review, and before the helper's possible first apply. It receives a structured clone of the original captured message, typed Readonly. This isolates the helper's message object; it does not freeze nested data or restrict a callback's external capabilities. The callback is an observation contract and must perform read-only snapshots. Its message is the retained original, not a refreshed assertion that every current database field is unchanged.

With deferFirstApply:true, the existing apply closure is returned without invoking it. The accepted validation and review assertions still run. With false/omitted, the existing apply and appliedCount:1 assertion still run. The observation callback runs once while change is prepared after real review, including deferred mode; it is not installed inside the returned apply closure and does not run on replay. In deferred mode it does not observe immediately before a later caller's eventual approval; that caller must obtain its own current pre-approval snapshot if needed. If observation throws, original/canonical/review writes already performed are not rolled back or misreported as absent.

## Existing UNT mechanism and codec limit

EdifactEnvelopeCodec in lib/ediel/core/edifactEnvelopeCodec.ts exports encode, decode and environmentFromLegacyTestFlag. It has no in-place UNT recount method. Its full encode regenerates envelope/header/date/format data and is unsuitable for preserving an intentionally transformed retained original.

The proposed patch imports the existing recountEdifactUnt export from __tests__/helpers/recountEdifactUnt.ts. It uses the existing release-aware tokenizer, requires exactly one ordered UNH/UNT pair, recounts their physical span and changes only UNT/0074. It preserves the existing message reference, UNA, business bytes, envelope values and formatting; it grants no authority and repairs no guide field. This helper already imports other __tests__ physical fixture utilities; no new file or counting implementation is introduced.

| Existing component | Identity |
| --- | --- |
| recountEdifactUnt.ts Git blob | d9e8beff57ce70e99b637675d1cf4044449913ae |
| recountEdifactUnt.ts SHA256 | 5f18ea75f3496e31727537ee13111a859e736c7faa48e4035517483d2a8efccb |
| EdifactEnvelopeCodec SHA256 | 92834d6d359a15b85e8244683de7a4c9df3075403918a7cc088930ef495095ed |

This proposal asks independent review to confirm reuse of that existing count-only utility as the physical UNT repair. It does not invent a codec export or hide the distinction. Count repair makes this option unsuitable for a test deliberately targeting an invalid UNT count or absent/multiple message trailers. Alternate transport/direction, full UNSM syntax negatives and multi-message admission remain outside this allocation.

## Observation and proof limits

A future legitimate callback can snapshot the current source's actual original/raw/hash/context, own structural object receipts/batches, own expectations, business tables and ACK/outbox rows before first apply. Assert zero current-source structural effects rather than zero tenant history: creating the existing fixture already produces a baseline supply/source and other ordinary synthetic artifacts. After actual processor/case/approval consumption, compare original scope, committed own effects and physical ACK/outbox/replay against those observations.

Deferral enables observing proposed first application; it proves nothing until the existing native stack is legitimately held and the real cases are executed. The callback does not create a case, execute ingress, emit ACKs or bypass any actual source/authorization/route owner. It does not grant genuine transport acceptance or first-birth reception proof.

The change still insists on accepted canonical and structural owner outcomes. It cannot return a captured invalid source through those assertions. Consequently the completed 25-cell matrix is a human backlog: representative N/U ingress cases, direction negatives, original mutation and independent false/unknown fact inputs are not magically executable through this allocated positive-input seam. No negative-capture bypass is proposed.

The public capture still fixes market:electricity and meterReadingsSentInUtilts:true. No qualified multiregister inventory, alternate actual supply boundary, invoicee source or unknown public-fact option is fabricated. Applying these knobs beyond the owner allocation requires a separate concrete owner decision.

## Held prerequisites

Field 306 remains held: structuralOwnerSource currently emits CCI++Z07/CAV+E22; retained original P26.A page60 and page122 evidence specifies Z11/Z12, and canonical306 lacks an allowedValues list. The patch does not substitute Z12 or edit the wire source, matrix, guide evidence or new acceptance files. Even default fixture acceptance is not declared national conformance.

Existing current actor permission, technical endpoint, source-bound reply route, rule/version, review, immutable source and ACK commit requirements remain actual gates. No fabricated communication.write registry/grant, protected readiness, legal mandate, source approval or provider acceptance is added. SMTP remains the previously declared external synthetic port and is not transport proof.

The allocation requires the exact current blob, proposed interface and reviewable patch to be posted before implementation, followed by an independently reviewed helper delta. It does not explicitly require a further retained-owner acknowledgement or approval. Root will independently review and publish this concrete proposal before authorizing the already allocated local implementation; retained503 carries the reviewed helper delta once. Existing native configuration and test registration remain #503-only. Future tests need the existing owned stack and must accurately classify failures. The preparer ran no tests, compiler, lint, installs, native stack, public API or publication for this proposal. Root alone runs any changed-code lint/types after implementation.

The separate z06-dependent-cells-native-design.md records all 25 frozen conditional cells and their missing controls. Neither artifact claims whole-contract acceptance.
