# Local simulated DSO scenario runner

`scripts/demo/elklart-ediel-scenarios.mjs` accepts private prepared EDIFACT bytes
and real fixture IDs, then invokes the existing `registerEdielFile` canonical
intake and `processInboundEdielMessage` ordinary processor. It never sets switch,
supply or meter status directly, calls selftest, creates certification runs,
installs qualified grammar, changes transport gates or grants source authority.

Commands from the OPS repository:

```
node --env-file=/workspace/elklart-runtime/ops/app.env scripts/demo/elklart-ediel-scenarios.mjs --fixture=/workspace/elklart-runtime/ops/anna-start.json
node --env-file=/workspace/elklart-runtime/ops/app.env scripts/demo/elklart-ediel-scenarios.mjs --fixture=/workspace/elklart-runtime/ops/anna-start.json --apply
```

Default is read-only custody preflight. Apply uses the same ordinary manual-file
intake as OPS and then its canonical source processor. This is a local DSO
simulation, not mailbox reception or market certification. The service endpoint
must be exactly `http://localhost:54321`, matching the OPS launcher's cookie-isolated
origin; the public and service URL values must agree. The active tenant must be the
dedicated `Elklart Demo` / `elklart-demo` tenant. Inputs must be private mode0600
files below `/workspace/elklart-runtime`, without symlinks. `tsx@4.20.6` is
installed separately in private runtime `ediel-deps`; source dependencies are
not replaced and repository packages are unchanged.

Each fixture JSON contains these fields:

| Field | Meaning |
|---|---|
| `scenario` | `anna-start`, `samir-move-in`, `jonas-end`, `meter-values`, `meter-correction` |
| `companyId`, `actorUserId`, `customerId`, `siteId`, `meteringPointId` | Existing local UUIDs, read back before mutation |
| `mode` | `internal_test` or `production_dry_run`; never AGT/TGT |
| `rawFile`, `rawSha256` | Private EDIFACT file and exact input byte SHA256 |
| `mailboxMessageId` | Stable 8–100 character fictional source receipt identity |
| `senderEmail`, `receiverEmail` | Fictional `@elklart.example.invalid` endpoints |
| `switchRequestId`, `expectedMarketStartAt` | Required for Anna/Samir; exact intended market timestamp |
| `supplyPeriodId`, `expectedMarketEndAt` | Required for Jonas; exact intended market timestamp |
| `expectedReadings` | For meter scenarios: array of `{periodStart,periodEnd,kwh}` |
| `previousMessageId` | Required for corrected values; existing own inbound UTILTS source |

Ordinary file mode `internal_test` gives environment=test/testFlag1.
`production_dry_run` gives environment=production/testFlag0 **inside this isolated
local database only**. Match the fixture's existing source/actor environment;
neither mode grants business permission. Do not mark real production resources
or a market test certificate as demo authority.

Prerequisites and scenario evidence:

| Scenario | Ordinary prepared prerequisite | Inbound/source result required |
|---|---|---|
| Anna | Her actual portal-created application/customer/site/point and ordinary switch | PRODAT Z04; matching source/switch-bound supply with exact market start |
| Samir | Ordinary `createDynamicSupplierSwitchRequestAction`, `request_type=move_in` | PRODAT Z04 and own move-in request; exact confirmed market start |
| Jonas | Existing own active supply and ordinary requested end workflow | PRODAT Z05; exact same supply with `source_end_message_id` and market end |
| Values | Own point, legal DSO context, qualified UTILTS and reporting/source prerequisites | UTILTS E66; exact current source-bound intervals and kWh |
| Correction | Prior ordinary UTILTS import and proper correction source references | New E66 current values plus retained non-current previous source values |

Customer/site/point must agree; the point must identify a DSO and physical meter.
Canonical intake separately checks the actor's ordinary write permission. Runtime
then checks actor registry, legal source context, original grammar qualification,
source correlation, transport and source-owner prerequisites. Unknown/missing
UNSM grammar is held before ACK and business effects. Held or failed processing
remains a blocker, even if a public status projection says accepted/active.

Existing `buildProdatInboundRaw` / `buildUtiltsInboundRaw` in
`lib/ediel/testing/selftest.ts` are small legacy payload builders, not qualified
source authority. They are not invoked here: they omit newer object/source
prerequisites and alone do not establish a runnable start/end/correction. Use
reviewed actual-format fixture bytes correlated to the ordinary prepared request;
do not rewrite source originals or create Masterplan GEN evidence for this demo.

The runner saves private per-attempt evidence to `ops/ediel-runs` with intake ID,
source hash, actual period/readings/events and explicit failure. Replaying the
same bytes/source identity goes through ordinary canonical duplicate handling.
For reset, restore the full isolated OPS+provider snapshot; do not delete source
messages or flip statuses to reconstruct a scenario.

Verification so far: four guard/assertion tests pass and both ordinary source
modules load with the real private runtime environment. These are not executed
end-to-end scenarios. No fixture has been applied by this runner yet. Anna's
portal-created fixture and qualified source prerequisites remain necessary.

Test command: `node --test scripts/demo/elklart-ediel-scenarios.test.mjs`.
