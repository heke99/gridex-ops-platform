# Local Elklart runtime operations

The dedicated runtime is `/workspace/elklart-runtime` (owner-private mode 0700). OPS is at [https://localhost:3000](https://localhost:3000); the portal is at [https://localhost:3001](https://localhost:3001). Use the private, checksum-verified Node 22 copy, `/workspace/elklart-runtime/bin/node22`. Keep credentials and runtime contents out of chat, Git and shared logs.

The process orchestrator uses only the known repository launchers. It does not create, replace or delete Supabase projects, containers, volumes or networks.

```bash
/workspace/elklart-runtime/bin/node22 /workspace/gridex-ops-platform/scripts/demo/elklart-demo-runtime.mjs status
/workspace/elklart-runtime/bin/node22 /workspace/gridex-ops-platform/scripts/demo/elklart-demo-runtime.mjs stop
/workspace/elklart-runtime/bin/node22 /workspace/gridex-ops-platform/scripts/demo/elklart-demo-runtime.mjs start
```

Pause browser scenarios, manual writers and background runners first. `stop` stops portal, OPS, SMTP, Resend and Capway using their exact owned metadata and process-identity guards. It skips absent metadata and checks both IPv4 and IPv6 loopback on ports 3000, 3001, 38480, 38481 and 38482. Only after every port is closed and every invoked stop succeeds does it atomically write private `apps-stopped.json` with `appsStopped:true`. A failed or partial operation leaves the marker false. It never kills an unrecognized listener or adopts legacy PID files; reconcile those explicitly.

`start` first sets the marker false. It requires all five services stopped with no existing process metadata, then starts Capway, Resend, SMTP, OPS and portal in that order. It checks authenticated Capway/Resend API responses and TLS-verified OPS/portal login responses. SMTP has a TCP readiness check; this does not replace the separately verified STARTTLS/authentication/send scenario. Start failures leave any successfully started owned services running and the marker false; inspect private logs and run `stop` before retrying. There is no destructive automatic cleanup.

`status` is read-only and reports process-metadata presence and open ports. Metadata presence alone is not proof of process ownership or business-flow health. The launcher scripts perform ownership checks when stopping. Process logs and supervisor records stay outside restored business state; snapshot allowlists cover private accounts, integration configuration, support receipts, provider ledgers, SMTP credentials and message receipts.

# Full environment checkpoints

Only the two dedicated local projects `elklart-ops-demo` and `elklart-portal-demo` are eligible. After a successful process stop:

```bash
# The qualified baseline already exists; restore it after a successful stop.
python3 /workspace/gridex-ops-platform/scripts/demo/elklart-snapshots.py restore foundation-qualified-v3-20261111

# Save a later baseline under a new name only after scenario verification.
python3 /workspace/gridex-ops-platform/scripts/demo/elklart-snapshots.py save next-qualified-baseline-v3
```

Save requires both dedicated Mailpit inboxes empty. Mailpit contents are transient and cleared when its containers restart; nonempty inboxes are not captured by these snapshots. Before stopping stacks, save verifies each exact project-owned Mailpit container and its sole loopback HTTP binding (54324 for OPS, 55324 for portal), then checks both inbox counts through direct HTTP with no redirects or environment proxies. Nonempty, malformed, unavailable or timed-out responses fail closed. Restore permits post-baseline messages and clears that transient inbox state on restart.

Choose an unused snapshot name when saving; snapshots are never overwritten. Restore stops only the exact recorded stack containers, restores all owned named volumes and the explicit private host-state allowlist, then restarts those stack containers. Application/provider processes stay stopped. Run the process orchestrator `start` afterward and verify the intended scenario. Docker health/startup can take time. A partial destructive restore leaves stack containers stopped for reconciliation; do not start applications against a partially restored state.

Restore checks container IDs, labels, image IDs, volume metadata, mounts, archive hashes and traversal safety. It restores Database/Auth/Storage/queue volume contents together with private bootstrap/provider identity state. Missing baseline allowlisted files are removed if created later; unrelated files remain untouched. The archives include fictional passwords and provider credentials, so their directory must remain private. Internal notes and customer content must retain their original tenant scope after restoration.

# Local archive helper

Supabase's bundled PostgreSQL image contains BusyBox tar, which cannot preserve the filesystem Storage backend's required extended attributes. Prepare and build the dedicated scratch helper from already installed local system binaries:

```bash
python3 /workspace/gridex-ops-platform/scripts/demo/elklart-snapshot-helper.py prepare
python3 /workspace/gridex-ops-platform/scripts/demo/elklart-snapshot-helper.py build
```

These explicit producer commands create only a private build context and the local image `elklart-snapshot-helper:gnu-tar-v1`; there are no downloads or package installations. The context contains `/bin/sh`, GNU tar, find, rm and their recorded shared-library closure. The Dockerfile uses `FROM scratch` and `COPY`, with checksum provenance and ownership labels. Existing contexts are preserved; a repeated prepare refuses to overwrite provenance. Build logs stay private.

The snapshot tool resolves the local image to its immutable image ID and refuses missing/mismatched ownership or provenance labels. Before stopping stacks it checks for GNU tar with `--xattrs` and `--acls`. Archive save and extraction preserve `user.*` extended attributes, numeric ownership and ACLs. The helper uses no network, never pulls, mounts only one exact owned volume, and runs with a read-only root filesystem and only the DAC_OVERRIDE/CHOWN/FOWNER capabilities needed for file restoration.

# Qualification status and limitations

On 2026-11-11, `foundation-qualified-v3-20261111` **passed the actual full reset qualification**: save the complete environment, mutate Auth and documents, restore, then verify both original OPS/portal Auth identities, original document bytes and document listing. The post-baseline file was absent after restore. The importer separately verified all 17 captured metadata fields for 23 private helper functions, with ACL readback also passing. The private evidence is `/workspace/elklart-runtime/ops/private-helpers-v3-qualification.json`. This is live runtime evidence, distinct from the local GNU tar unit test whose host filesystem lacked ACL support.

The earlier failures remain part of the record:

- The first foundation restore failed: Database/Auth returned, but Storage downloads returned HTTP 500 with `ENODATA` because the original archive omitted required extended attributes.
- The first v3 save attempt failed because the vendor PostgreSQL helper contained BusyBox tar, which rejected the GNU tar flags. The dedicated locally built scratch helper, provenance checks and capability preflight replaced it.
- An earlier complete-v3 restore recovered Auth and documents but failed private helper metadata qualification. The old renderer emitted `SET search_path TO 'public, pg_temp'`, treating the whole value as one quoted schema; actual `current_schemas` was empty instead of the captured `public, pg_temp` setting. Renderer v3 transfers the captured raw GUC through transaction-local `set_config(..., true)`, applies `ALTER FUNCTION ... SET search_path FROM CURRENT`, then restores the caller's local setting. The importer requires v3 and checks actual metadata before and after import. The live 23-function × 17-field comparison and ACL readback above qualify this fix; the earlier baseline remains retired.

The older `foundation-20261110`, `foundation-gnu-v3-20261110` and `foundation-complete-v3-20261110` baselines are retired. Their manifests were renamed to `manifest.retired.json` with the reason preserved; normal restore cannot select them. Use the qualified baseline above. Do not rename retired manifests back or treat their historical failures as passing results.

Full reset qualification does not establish that every business scenario or presentation rehearsal is complete. After restarting the application/provider processes, verify the intended scenario and current role/tenant behavior. Run the main presentation twice with a full reset between runs and record actual outcomes in the demo verification record; launcher readiness and unit tests do not replace those flows.
