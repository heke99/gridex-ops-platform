# PHASE-42 next actions

1. Sync the delivered files into the Git checkout.
2. Run clean Node 22 install and full project gates when the package registry works.
3. Export `DATABASE_URL` and run `scripts/sync-multitenant-website-application-flow.sh`.
4. Review the dry-run output; stop if the script reports any migration as `unsafe`.
5. Deploy OPS only after postflight succeeds.
6. Canonically provision Gridex with its real Mina sidor URL and configure a signed webhook.
7. Provision a second tenant through the same UI/code path with different origins, offers, mail and portal URL.
8. Submit one application per tenant and verify customer number, application number,
   portal ownership, email delivery, exact status lineage and webhook retry/deduplication.
9. Run explicit cross-tenant denial checks for status, portal bundle and webhook payloads.
