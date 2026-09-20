# PR359 review5753067624: leading non-PRODAT FTX hold

Scope: narrow correction to the existing source-qualified first-PRODAT reader. Parent before correction5c7fc3b454f042ed0db95e7957ec4780fbbe794f preserves the new test while runtime is unchanged from reviewed6ce695c4/3c4a57df. No source, policy, global register grouping, schema, tenant, role or workflow changes.

## Confirmed finding and RED

The published prodatFreeTextSendIssues inspected the first UNH and returned for APERAK even when a later first-PRODAT contained malformed FTX. readProdatFreeText passed the unselected token list to the existing one-message register owner, which deliberately rejects a non-PRODAT first message. The source-qualified FTX pre-I/O boundary therefore missed the actual target.

New real-module script test-ediel-prodat-free-text-first-message.cjs uses one UNA/UNB/UNZ, separately counted/referenced UNHs/UNTs and three service alphabets. Baseline execution:25tests,7pass18fail0skip/cancel/todo. Literal framing and no-PRODAT opposing controls pass; actual reader, preflight, rulebook/send-lock and registry consumers fail the required FTX assertions. No import/setup failure or external operation is counted. RED log SHA256ab2b61c17bf7616b6e99cd12a3f806a27d8f831377e53313c6990c560dbd89cc.

## Bounded correction

One private selector in prodatFreeText.ts locates the first decoded PRODAT UNH, slices there and delegates message-end/register handling to the unchanged existing owner. Both FTX reader and wire send decision use it. Header-free scoped fragments retain their prior behavior; no-PRODAT interchanges do not borrow a stale row label. Later message text remains outside this first-PRODAT scope. This is a local pre-I/O hold, not permission to send a mixed/ambiguous interchange or replacement of existing whole-message/UNSM validation.

The existing Vitest wrapper now executes both native scripts with the same positive-count/all-passed/zero-failure controls. Six added real SMTP tests cover leading APERAK across3alphabets and2row labels, with no DB/provider effects; these must run in ordinary CI. The earlier positive SMTP controls retain only their existing route-DB-boundary claim, not a delivered message.

## Executed local verification before publication

- Combined old248 +new25 native cases:273/273pass0fail/skip/cancel/todo. SHA2564ec6b17841fb258323d34dff82b1b4c2b85a3e7c43a28c89de2a8211a8270251.
- Selected8 prior native files:648/648pass0fail/skip/cancel/todo. SHA256deefa9577335c3ad2278b42b412500b661d6f98531afa78f176db1cc35ba99a1.
- Local Node22.16.0. Actual Vitest/typecheck/ordinary CI for this new revision is not claimed yet; prior isolated proof35540907964 remains historical for6ce only.

Next: independent review of this exact correction plus ordinary final-head CI, including18realSMTPtests andnativewrapper. Resolve actual findings before guardedmerge and fresh actual-main73/OPS. PR358/D110+10 alreadyaccepted; fullF3/masterplanNOT_COMPLETE;PR310paused e9611351 untouched.
