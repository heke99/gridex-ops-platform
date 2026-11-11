# Elklart isolated runtime

This is a local, incomplete system demo. It has not passed the uploaded full acceptance plan or the two presentation rehearsals.

## Open and access

- OPS: <https://localhost:3000/admin/elklart-demo>
- Customer portal: <https://localhost:3001>
- Controlled message inbox: <http://127.0.0.1:54324>

These URLs belong to the current workspace machine. They are not public deployments. HTTPS uses the private runtime CA at `/workspace/elklart-runtime/tls/ca.pem`; trust that CA in the presenting browser. Do not disable TLS verification globally.

Credentials are private local files, never repository contents: `/workspace/elklart-runtime/ops/accounts.json` contains separate platform, administrator, handler, portfolio, support and automation accounts. Portal persona credentials are stored separately under `/workspace/elklart-runtime/portal`. Open those files privately in the workspace; do not paste them into chat, screenshots, issue reports or Git. Customer-service support is a distinct existing role; operations_agent does not acquire support permissions.

## Genuine boundaries already exercised

Both applications and independent local Supabase platforms run. Normal portal registration/login and authenticated customer-assertion provider registration/enforcement passed. Canonical company/staff provisioning, legal profile review, offer version publication and channel publication passed. Ordinary admin forms saved BRP/routes, verified the sender against the local provider simulator, and created standard mail templates/rules. Karin's ordinary staff support case/call/internal note/public reply passed; customer visibility verification is separate.

The controlled manual mailbox has verified local SMTP delivery and **no IMAP configuration**. Its evidence explicitly makes no inbound mailbox or market verification claim. `scripts/demo/elklart-manual-mailbox.mjs` prepares this configuration through the normal admin form after checking a successful SMTP simulator receipt. The existing poller excludes mailboxes with no IMAP host.

Local SMTP uses trusted mandatory STARTTLS and relays exact MIME only to the Docker-verified owned Mailpit. Resend and Capway adapters restrict requests to local controlled resources. Their results are simulated provider results, not external certification or real invoices/payments.

## Pending acceptance

Canonical tenant activation still requires real external Ediel/eSett evidence. The local tenant is onboarding until that constraint has an explicit, safe demo solution. Do not insert passed certification records or force active status to hide the blocker. Anna's portal signup and source-authorized supply transition, the remaining customer scenarios, invoice publication, role/tenant negative matrix, full real reset and two rehearsals remain pending.

The real `foundation-qualified-v3-20261111` reset passed across all 12 owned containers and four persistent volumes, with matching private host state. After deletion, both projects recovered their original probe Auth identity and exact document bytes; documents created after the snapshot disappeared. Earlier attempts exposed lost Storage extended attributes and an incompatible BusyBox helper. They are invalid baselines. The successful baseline uses a checksum-recorded scratch GNU tar helper and preserves Storage attributes. This verifies the reset mechanism, not either presentation rehearsal or persona start/final states. See [operations](elklart-runtime-operations.md).

Current fictional customer/case links are in [workspace links](../quality/elklart-demo/runtime-links.md). Start, stop and status use `/workspace/elklart-runtime/bin/node22 scripts/demo/elklart-demo-runtime.mjs start|stop|status` from the OPS repository. Both frontends and all three local adapters were restarted and passed health checks after restoration.

Prepared forecast/purchase profiles remain explicit demo assumptions. Missing measurement data remains missing; synthetic examples do not substitute for ordinary imported meter readings.
