# Protected synthetic pricing companies

This delivery creates only new, explicitly synthetic test companies through normal canonical provisioning. It never enrolls an existing company. It does not activate a spot source or authorize pricing, settlement, invoice preparation or delivery. Financial consumers remain disabled until their separate source and execution qualification.

## Birth and authority

`POST /api/internal/pricing/synthetic-test-companies` requires the actual current platform administrator established by the existing authenticated API guard. SQL independently requires a confirmed, nonanonymous, nondeleted, nonbanned Auth user, active profile and `canonical_actor_is_platform_admin`. Ordinary `pricing.write` authority cannot create this permanent company restriction. Capture/review of spot originals retains its separate nonplatform actor policy.

The UTF-8 request has exactly `name`, `slug` and `declaration`, plus a UUID `Idempotency-Key` header. Names have 1–200 Unicode scalar values, no leading/trailing whitespace, C0/C1 control characters or unpaired surrogates. Slugs have 1–63 lowercase ASCII letters/digits with internal hyphens, starting and ending with a letter/digit. No company ID, organization number, email, invitation, metadata, actor, timestamps or provider configuration is accepted.

The declaration must be exactly `SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT`. It explicitly acknowledges that the new company permanently prohibits production billing and all external financial delivery, including test providers and export-file downloads. There is no implicit declaration or conversion of a previously created company. This is a financial safety capability, not a substitute for the separate Ediel issuer, test namespace or LIVE authority gates.

The bounded API stream accepts at most 8192 bytes, decodes fatal UTF-8 and requires exact `JSON.stringify` equality. SQL independently validates the supplied fields. It derives a fresh company UUID and a canonical request key `synthetic.pricing.company.v1:<actor UUID>:<request UUID>`; callers cannot choose or adopt either company identity or another provisioning command.

The creation command invokes the actual `canonical_provision_company` and inserts the private immutable birth restriction in the same transaction. It omits initial-admin invitation fields. Normal provisioning jobs, audit and outbox remain normal provisioning effects; no claim is made that omitting invitations qualifies all workers or private delivery. No company is visible without its protection. The resulting onboarding status is preserved; no membership, Auth identity, accepted invitation, active company status or market authority is fabricated.

## RPC and reconciliation

The service-only public functions are:

- `gridex_create_synthetic_pricing_company_v1(p_actor_user_id uuid, p_request_key uuid, p_name text, p_slug text, p_declaration text)`
- `gridex_read_synthetic_pricing_company_v1(p_actor_user_id uuid, p_request_key uuid)`

Both recheck current platform authority before lookup or replay. The command hash is SHA-256 of the exact UTF-8 preimage `gridex-synthetic-pricing-company-command-v1\n` followed, in order, by each of name, slug and declaration framed as its decimal UTF-8 byte length, a colon and the original string. There is no Unicode normalization, JSON rendering or separator between these length-prefixed fields. API and SQL independently calculate this hash; Unicode spelling is preserved. The creation function uses the canonical `tenant.provision:<canonical key>` advisory lock before inspecting canonical request state, then follows canonical provisioning's existing lock order. It must not hold a SHARE lock on `companies` before inserting a company: concurrent creators would otherwise deadlock on lock upgrades.

Only the original actor and request key may replay their own immutable birth command. The command hash, actual canonical provisioning request/result and protected company must agree. Changed fields conflict. A preexisting canonical request without the matching protected birth is a conflict, including a request that happens to point at an otherwise empty company. A fresh UUID is generated only on the fresh path. There is no automatic mutation retry or deletion after an uncertain response.

`GET /api/internal/pricing/synthetic-test-companies?requestKey=UUID` reads the current actor's persisted birth receipt without mutation. It rejects duplicate/unknown parameters. Unknown and another actor's request keys have the same private 404 response. This is the reconciliation path after an uncertain POST.

Receipts contain exactly `company_id`, `birth_id`, `request_key`, `actor_user_id`, `initial_name`, `initial_slug`, `declaration`, `command_sha256`, `company_created_at`, `recorded_at`, `production_billing_prohibited:true`, `external_financial_delivery_prohibited:true`, `consumer_enabled:false` and `replayed`. Timestamps are actual server observations formatted as millisecond UTC instants. They do not backdate any source or confer historical/future settlement authority. The API validates the exact returned identities, command, hash and fixed restrictions before responding. Responses are private/no-store/nosniff; database and transport details are not returned.

## Permanent financial boundary

The new private birth record and its provenance are immutable and company-bound. Fixed-search-path, qualified definer functions expose only the two narrow service RPCs. PUBLIC, anon and authenticated execution and direct private-table access are revoked; private RLS and update/delete/truncate refusal remain defense in depth. The entire forward is transactional, including final privilege revocations.

Before the birth commits, the company has `invoice_export_enabled=false` and `outbound_frozen_channels` includes `invoice_export`. Protected SQL guards permanently prevent enabling invoice export or removing that channel. Other companies retain their existing behavior. Provider/environment edits, source withdrawal, company renaming or application flags cannot remove the private restriction or alter the recorded company identity and birth provenance.

The existing `assertOutboundAllowed({channel:'invoice_export'})` already stops approved dispatch, legacy dispatch/retries, partner delivery and invoice-file creation before external work. Its implementation remains unchanged. Both existing export download routes must also call that guard on the actual persisted object's company before building/rendering bytes. Export-center uses the loaded run's company. The invoice-file DTO omits company identity, so that route first performs a company-scoped persisted `invoice_export_files` ID/company lookup, validates it and calls the guard before loading/rendering content. A denied/erroring check returns no file. This closes existing paths that can render an already stored draft without creating a new file.

SQL independently refuses production financial configuration and production canonical run/item/invoice/file graphs, including direct DML and callable core/legacy/queue paths. For the protected company, no provider-result/external financial identifiers or delivery-completion state may be introduced. In particular, the purchase route requires a provider invoice GUID before contacting the provider; that prerequisite must remain absent through SQL protection. A post-delivery event trigger alone is insufficient because provider calls can precede the status write.

The current-schema guard coverage is:

- `companies`: test default/operating environment, NULL/test billing-provider environment, export disabled, permanent financial freeze channel and immutable recorded company/birth identity.
- `billing_provider_connections`: only test environment and no reassignment of a protected company's rows.
- `invoice_export_runs`: internal test draft/cancelled, zero delivery counts and no processing start.
- `invoice_export_items`: internal test pending/cancelled, zero attempts, no retry, file link, provider identity/reference/result or delivery timestamps/payloads.
- `customer_invoices`: internal drafts without issue/payment/file/external identifiers. Canonical `pending:<item UUID>` and `draft:<item UUID>` internal references remain valid.
- `billing_export_runs` and `billing_export_run_items`: internal unqueued state, zero delivery/retry counts and no partner result/identity/timestamps.
- `invoice_export_files`, `partner_exports`, `invoice_export_attempts`, `invoice_purchase_events`, `invoice_documents` and `customer_invoice_documents`: no protected-company insertion or update.

Guards examine OLD as well as NEW ownership. They resolve actual parent ownership for ID-only links, including invoice run/item/document links, both legacy run links, customer invoice document links and canonical/legacy item links. A foreign or NULL company cannot attach to a protected parent, and a protected child cannot be moved away. The immutable company birth record uses a restrictive company FK. These checks must not add company/parent row locks that reverse existing graph/queue lock order. There is no `invoice_exports` relation on this base and no fictitious legacy hook is introduced.

`partner_exports.company_id` is nullable, so its actual customer, billing-underlay, site and metering-point parents are checked independently. Identity guards on `billing_underlays`, `customer_sites` and `metering_points` prevent ownership reassignment into/out of the protected namespace. Since sites and metering points can also have NULL company IDs, guards reject a foreign/NULL owner with a protected customer or site parent; output ownership cannot be hidden by passing through an ambiguously owned intermediate parent. Ordinary same-company internal rows remain possible; existing pricing fields and composite FKs are not rewritten.

Internal test draft/pricing amounts may remain inspectable. No provider send or downloadable financial export is needed to verify those amounts. Actual table/column coverage is derived from the current schema and exercised with direct DML and canonical-path controls, not inferred from TypeScript alone. Source activation and monthly/interval consumer lineage are a later required delivery.

Automatic invoice-event webhooks are also financial output. The existing webhook policy does not honor the invoice-export freeze. Additional native guards therefore reject protected OLD/NEW ownership in `webhook_subscriptions` (all statuses) and `webhook_deliveries`, including the actual subscription, domain-event and subject-customer owners. Where a structured link includes an API client, its actual owner is checked too. `domain_events` may capture private events normally but cannot move into/out of protected company ownership or attach a protected subject under a foreign/NULL company. Customers and API clients cannot be reassigned into/out of protected company ownership to launder these links.

Actual invoice-event emission stores the private domain event and queues only active same-company subscriptions. With protected subscriptions impossible from birth, internal test drafts retain their events with zero outgoing fanout. Delivery guards cover direct queue insertion and parent aliases independently. There is no separate webhook-endpoint table or new sender implementation. Tests must exercise actual enqueue/dispatch callback behavior with zero transport calls, plus direct SQL parent/reassignment bypasses. The contract covers structured financial output paths, not arbitrary malicious service-role payload rewriting or an authorized human manually copying information into an unrelated message.

## Verification and remaining gates

Tests execute the registered route handlers, existing outbound guard and download callbacks, and actual forward functions/triggers. Controls cover current platform revocation, exact replay, foreign/unknown reconciliation, ordinary-provisioning collisions, atomic rollback, immutable protected state, direct configuration/financial bypass attempts, purchase prerequisites and refusal before file/provider work. Finite Auth/seed/worker ports and PGlite remain component evidence, not qualified native Auth, multiconnection concurrency or full-main replay.

T4 retains shared checksum/GEN and serial integration. The new migration, ordinary provisioning jobs, fresh owned host, actual actors and private delivery still require normal qualification. No whole TERM result, production capability, native allocation, producer handoff or new scenario PASS follows from this source package.
