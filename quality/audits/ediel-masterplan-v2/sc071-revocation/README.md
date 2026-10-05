# SC-071 native projection/revocation component

Three new native cases exercise real grant revocation against the existing
beneficiary projection, including both transaction orders and rollback. The
current independent review approves the static component. **Native
NOT_QUALIFIED; whole SC-071 remains unapproved.** The first local setup failed
before database replay. Actual CI run37293845384 on f75cdd7d then refused
artifact publication because credential redaction was incomplete; no native
counts were qualified. Both failed attempts remain recorded.

The new `.github/workflows/ediel-sc071-native.yml` invokes the unchanged
canonical replay and this selected config on the exact PR head. It requires
three cases with no failures/errors/skips and publishes only redacted feedback,
including a stage receipt if replay fails. Its initial static review finding
and correction are retained in `native-feedback-review.md`; finite workflow
control probes do not establish database or native behavior. Actual CI native
execution remains pending until its artifact is qualified. The correction
passes the CLI SECRET_KEY format to the unchanged canonical scrubber; the
credential refusal remains in place. Static review and finite format controls
pass, but cannot qualify the next real native run.

SC-010 remains with [PR #570](https://github.com/heke99/gridex-ops-platform/pull/570)
at `7a894c3b7938daf9bbbab7680f71ca5911aefc9c`; its finite HTTP component is
reused by reference. Ownership handoff: #530 comment5991386261, accepted5991584319.

The retained coordinator can run the selected native cases in the already
qualified canonical local/CI stack:

```sh
GRIDEX_NATIVE_STATUS="$existing_owned_status_path" npx vitest run \
  --config quality/audits/ediel-masterplan-v2/sc071-revocation/native.config.ts \
  --reporter=default --reporter=junit --outputFile=sc071-native-junit.xml
```

The selected config imports the existing canonical guards, aliases, fixture
setup and deadlines. No shared include, source, SQL, helper, schema, migration,
manifest, generated artifact or coverage row changes are made. A shared-suite
include still needs the coordinator's cleared ownership window.

Whole approval additionally needs the actual queued/leased export/distribution
consumer and its current grant check before disclosure. The SC010 source owner
has claimed the sole first production exporter in #530 comment5992097869;
its implementation, exact RPCs and coordinator schema admission remain pending.
SC071 will exercise that same real producer. SQL transaction locks alone do not
prove a later export/send boundary.
