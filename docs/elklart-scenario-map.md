# Elklart: prepared catalogue and scenario map

This document distinguishes a prepared start state from an executed scenario. Nothing in the fixture builder proves a customer journey. All people, prices and legal text are fictional and only valid in the isolated local demo.

Skill routing: Supabase applies to canonical local RPC provisioning; verification-before-completion applies to evidence claims. UI, performance, production deployment and Ediel masterplan changes are outside this fixture scope. Shared memory and other producers remain owned by the coordinating agent.

## Immutable program reference prerequisites

Schema-only restore omits reference rows. Before canonical tenant provisioning, generate the bounded reference SQL:

```sh
node --experimental-strip-types scripts/demo/elklart-fixtures.mjs --reference-catalog-only
```

This performs no database requests. It writes private `ops/reference-catalog.sql` and `ops/reference-catalog.provenance.json`. The SQL admits only the dedicated database marker and inserts the exact literal `record_class_catalog` and `process_class_catalog` rows from repository migrations `20261001012305` and `20261001015945`. It verifies existing rows match those definitions and aborts on mismatch. The provenance records full source and extracted statement SHA256. These are immutable program classifications, not retention decisions, issuers, legal deadlines, grants or customer data.

The tenant legal-profile trigger emits `contracts.publication.changed` into **domain_events**. Its retention guard needs the checked-in `portal_domain_event_history` classification. There is no separate `contract_publication_events` classification to invent.

## Prepare

After `scripts/demo/elklart-ops-bootstrap.mjs`, run from the OPS repository:

```sh
node --experimental-strip-types scripts/demo/elklart-fixtures.mjs
```

The builder accepts only the dedicated loopback OPS API on port 54321, the canonical `elklart-demo` tenant, and private runtime paths. It reads `/workspace/elklart-runtime/ops/{status,tenant}.json`. It creates the website API client through `gridex_provision_tenant_website_client_v1` in **development**, with the product's actual `tenant_website` scope profile, and saves the one-time credential immediately to private `ops/integration.json` (0600). It never prints secrets. An existing client without its original private credential fails closed instead of inventing a replacement token.

Provisioning the client alone does **not** establish website readiness. The ordinary `provisionTenantWebsiteIntegration` service in `lib/integrations/tenantWebsiteProvisioning.ts` also configures the portal URL/webhook and performs scoped external preflight and launch-readiness checks. Complete those normal checks before claiming that signup works. The saved webhook secret is integration configuration material; it is not proof of webhook registration or delivery.

The catalogue builder then uses these ordinary commands:

1. `gridex_update_company_and_rebuild_legal_profile`, followed by `gridex_review_company_legal_profile`.
2. `gridex_create_tenant_legal_override`, for published fictional replacements of the canonical legal modules. The builder first restores source-derived legal master references and exact legal requirement rules from repository literals, with SQL/source SHA256 provenance. It then creates the published tenant replacements through the canonical RPC.
3. `gridex_upsert_internal_contract_offer_v3`, saving a draft with the required v6 commercial selection schema, an explicit SE4 fixed price option, monthly fee and invoice fee.
4. `gridex_publish_internal_contract_version` freezes the draft through its ordinary readiness gate.
5. `gridex_publish_contract_channel`, independently for internal, website and API. These commands own publication readiness and immutable bindings.

Prepared price assumptions: 100 öre/kWh, 39 SEK/month, 0 SEK/invoice, consumption in SE4, 12-month binding, one-month notice. These are deliberately fictional catalogue assumptions. They are not market price observations or an executed customer acceptance.

Readiness failures stop the builder. Published rows are not edited directly. No customer, customer login, contract, delivery start/end, invoice, forecast, or metering data is created by this builder. In particular, Anna is **not** pre-created or confirmed. `ops/fixtures.json` records catalogue provenance and offer ID, not scenario success.

## Current system constraint

The real canonical activation check requires approved external Ediel/eSett qualification; the fictional tenant remains onboarding. Local provider tests do not establish those external approvals. Portal application/customer reads currently stop with `organization_onboarding`. No fake certification records or forced active status have been inserted. An explicit local demo lane with unchanged production protections is a pending user choice.

The controlled sender, BRP/routes, templates/rules, legal catalogue and offer channels have been prepared through ordinary actions. Capway TEST selection and a real OPS-to-local-provider Ping passed. This is not an exported invoice. See [runtime status](elklart-runtime-status.md).

## Execution map

| Scenario | Required prepared state | Ordinary execution and proof | Current fixture coverage |
| --- | --- | --- | --- |
| Anna Lind | No application/customer; published offer, prices and legal documents; ready website client | Portal form → application/customer in OPS → simulated network response at inbound boundary → confirmed delivery → own portal + interval portfolio | Catalogue builder only; actual signup and all downstream steps require execution |
| Samir Ek | Planned move-in with traceable prepared-state provenance | Normal move-in workflow; contract/consumption starts at actual confirmed delivery interval | Customer baseline not created here |
| Sjövik Verkstad AB | Two sites and active contracts, explicitly marked prepared; invoice and meter prerequisites | Own site switch; traced evening-shift assumption; ordinary meter import + correction; canonical billing calculation/publication; portal invoice | Customer/site/meter baseline not created here |
| Karin Holm | Published demo invoice and support starter, marked prepared | Staff support case, internal note, customer-visible reply; customer read proves note exclusion | Actual staff case/call/internal note/public reply passed; own portal registration passed. Invoice relation and customer projection remain blocked/unverified |
| Bergdala Fastigheter AB | Rejected previous switch attempt, marked prepared | Ordinary staff correction/retry; trace new intent and verify no duplicate effect | Rejected baseline not created here |
| Jonas Vik | Active contract before move-out, marked prepared | `gridex_submit_customer_move_out_v1` through product service; inbound confirmation; final bill; future portfolio removal and retained history | Active baseline not created here |
| Roles/isolation | Customer, staff, portfolio manager, administrator mapped to existing roles | Real Auth positive/negative requests and second-tenant denial; do not infer isolation from service-role fixtures | Platform, administrator, operations, portfolio, customer-service and automation accounts exist; actual Auth/RLS matrix passed for four staff accounts (portal authorization remains blocked) |
| Optional: contract amendment | Existing contract with legal immutable version | Verify available canonical service path and effects before enabling | Not claimed runnable |
| Optional: cancelled start | Pending ordinary application/start intent | Verify available cancellation service path before enabling | Not claimed runnable |
| Optional: invoice credit | Published original invoice | Verify canonical credit action and portal visibility before enabling | Not claimed runnable |

OPS workspaces: `/admin/contracts`, `/admin/customers/intake`, `/admin/customers`, `/admin/companies/{companyId}`. Substitute IDs from private runtime outputs. Direct customer/application links can only be supplied after those records actually exist; never invent IDs.

## Reset and evidence

Use the complete isolated runtime snapshot/reset tooling, including both databases, Auth, documents and queues. A filter reset or rerunning the catalogue builder is not a full reset. Preserve private integration credentials with the matching database snapshot; otherwise stop for ordinary credential recovery. Never delete an API client merely to make the recipe rerun.

A presenter fallback must be an independently named snapshot labelled **prepared final state**. Seeded delivery/invoice states are not evidence that inbound, billing or customer actions ran.

The targeted fixture tests use replaced dependencies and prove local target rejection, canonical command rejection, credential persistence/reuse and publication command routing. They do not prove real RPC bodies, real Auth, portal signup, inbound delivery, billing, tenant isolation, reset or the required two full presentations. The coordinating runtime evidence must report those separately.

## Actual isolated execution, 2026-11-10

The canonical website client was created and its original credential persisted privately. The canonical tenant legal profile update/review and 28 tenant legal override commands succeeded. Exact repository master template/rule constants were installed as prepared program data, retaining source and SQL hashes in private `ops/legal-reference-catalog.provenance.json`. The SE4 draft offer and canonical commercial/price versions were created through v3 draft upsert.

The initial `tenant_go_live_not_ready` prerequisite was resolved through ordinary BRP, route and sender configuration. Actual read-back at 23:17 UTC confirms actor/BRP/PRODAT/UTILTS/sender flags true, the current offer `published`, and internal/website/API channels all `active`. The first frozen version had an incorrectly authored VAT snapshot and was preserved; a successor with canonical 0.25 VAT was created through the normal version command. No locked history was rewritten. The canonical website/API permission commands explicitly enabled those channels before publication. The active offer ID is recorded in private `ops/fixtures.json`; complete scoped read-back is in private `ops/catalogue-readback.json`.

No signup, customer delivery, invoice scenario, website readiness preflight or launch-ready transition is proven by these results.

## Fictional EDIEL boundary configuration

The actor recipe calls `canonical_save_ediel_actor_profile`, the same canonical command used by `app/admin/companies/[id]/ediel-actions.ts`. Fictional supplier `ELKLARTDEMO` and BRP identifier `ELKLARTDEMOBRP` are explicitly labelled prepared demo data, with no market certification. This command has run successfully on the isolated stack.

The optional `--ediel-ui` and `--routes-only-ui` modes use the actual SMTP route configuration actions. Communication endpoint remains null; an optional metadata URL is accepted only for loopback. Actual transport is controlled by `EDIEL_SMTP_*` server environment settings, independently of route metadata. It performs actual local Auth login, submits the ordinary BRP form, and invokes `createEdielBootstrapRouteAction` from the existing legacy route form for PRODAT/UTILTS. Route configuration retains required encryption and certificate checks, test flag 1 and no emergency exception or live attestation. Provenance metadata is annotated after successful normal configuration; this annotation changes no operational state. Destinations outside loopback are rejected before browser login.

```sh
ELKLART_EDIEL_ADAPTER_URL=http://127.0.0.1:PORT/ACTUAL_ADAPTER_PATH \
  node --experimental-strip-types scripts/demo/elklart-fixtures.mjs --ediel-ui
```

Omit this variable for SMTP-only configuration; an optional URL is metadata and must identify an actual controlled adapter. Creating these routes is not evidence of successful encrypted dispatch, an accepted market-governance source or network-owner confirmation. Keep true certification/activation failures visible. Email sender setup remains owned by the normal sender verification service and its controlled local provider adapter.

At 23:17 UTC the actual routes target `network-owner@elklart.example.invalid`, host `127.0.0.1`, port 38482, require encryption and a receiver certificate, and retain `production_mode=disabled` and `is_production_ready=false`. These checks were **not** overridden. Successful catalogue publication therefore does not prove an executable certified market dispatch.

The `--brp-email-ui` mode ran real Auth and ordinary settings/start/check/bootstrap actions. The sender is verified **inside the simulated provider realm only**; it is not a real DNS/domain attestation. The ordinary email bootstrap action created 13 templates and 13 event rules. Private `ops/sender-prepared.json` records this provenance.
