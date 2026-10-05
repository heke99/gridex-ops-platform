# SC-071 native projection/revocation component

Three new native cases exercise real grant revocation against the existing
beneficiary projection, including both transaction orders and rollback. The
current independent review approves the static component. **Native NOT_RUN;
whole SC-071 remains unapproved.** The canonical local setup failed while
registering a Docker image layer, before database replay or test execution.

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
consumer and its current grant check before disclosure. Only the synchronous
beneficiary GET producer has been found. SQL transaction locks alone do not
prove a later export/send boundary. Existing source owners must identify or
clear that missing producer; these tests do not invent one.
