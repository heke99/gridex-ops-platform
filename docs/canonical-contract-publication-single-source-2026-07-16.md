# Canonical contract publication, legal evidence and tenant communication

Date: 2026-07-16

## Purpose

This completion patch makes contract publication a single database command with one
canonical decision path. Drafts may be incomplete, but a published contract must
resolve pricing, legal requirements, immutable evidence, publication and audit data
inside one PostgreSQL transaction.

The runtime chain is:

```text
tenant legal profile
→ contract draft
→ immutable price plan version and price book
→ dynamic required legal modules
→ rendered and immutable legal bundle version
→ immutable contract product version
→ contract publication version
→ public website/application API
→ customer contract with exact version references
→ version-locked e-mail and PDF evidence
```

## Canonical boundaries

### Publication write boundary

All company-card saves and publications call:

```sql
public.gridex_publish_contract_version(
  p_company_id,
  p_draft_contract_id,
  p_offer_code,
  p_payload,
  p_pricing_snapshot,
  p_actor_user_id
)
```

The command is the only active UI write path for website contract drafts and
publication. `public_contract_offers` remains a transition/compatibility input inside
the database command; application code does not publish by updating that table.

The command performs the following in one transaction/subtransaction:

1. Locks and validates tenant, actor and draft identity.
2. Validates exact tenant legal-profile completeness and review state.
3. Calculates legal modules from customer type, contract type, channel, power of
   attorney, automatic renewal and production.
4. Resolves or creates the compatibility legal source bundle inside the same
   transaction.
5. Creates or reuses the immutable price plan version and price book.
6. Creates the immutable contract product version.
7. Renders one canonical legal evidence document row per required module.
8. Blocks unresolved placeholders and missing modules.
9. Creates and publishes the exact contract publication version.
10. Supersedes prior active publication versions atomically.
11. Returns structured readiness, blockers, IDs and correlation ID.
12. Writes an audit event in the same transaction.

A recognized readiness/legal failure rolls back all publication writes before a
structured blocker response is returned. Unexpected database failures are re-raised
and roll back the entire transaction.

### Removal boundary

The company-card UI calls:

```sql
public.gridex_remove_contract_offer(
  p_company_id,
  p_offer_id,
  p_mode,
  p_actor_user_id
)
```

The function locks the offer and checks historical price snapshots in the database.
A published or historically referenced contract is archived. Only an unused draft is
deleted. This removes the race between an application-side count and a direct delete.

The internal contract screen uses the same pattern:

```sql
public.gridex_remove_internal_contract_offer(
  p_company_id,
  p_offer_id,
  p_mode,
  p_actor_user_id
)
```

Any customer history, internal offer-version history or canonical price/product
reference forces archival. A physical delete is therefore limited to a truly unused
legacy draft. The active application no longer contains a direct `contract_offers`
update/delete path or the obsolete direct-save helper.

## Tenant legal profile

`tenant_legal_profiles` is the legal master profile. The migration adds:

- exact `missing_fields`,
- `review_required`,
- a snapshot/hash of legally relevant company fields,
- source update timestamp.

Known company values are backfilled without inventing missing legal facts. The profile
is incomplete until all required fields contain meaningful values and basic formats
are valid. Company changes only trigger review when a legally relevant source field
changes; a general company `updated_at` change is not part of the hash.

Publication returns field-level blockers such as:

```text
missing_legal_profile_field:postal_address
missing_legal_profile_field:complaints_contact
tenant_legal_profile_review_required
```

The company UI consumes the aggregate canonical readiness view and shows missing
fields, whether a new review is required, last verification and profile update time.

## Dynamic legal requirement engine

`gridex_required_legal_modules(...)` is the database source of required modules. It
fails closed when no active rule matches the selected customer type, contract type
and channel.

The rules cover the existing models and explicitly add:

- private versus business requirements,
- quarterly pricing,
- business signatory, credit/late-payment and liability modules,
- distance-contract information for consumers,
- agreement confirmation,
- terms-change notices,
- automatic renewal only when enabled,
- power of attorney only when enabled,
- production terms only when production is enabled.

A five-document legacy package is not treated as universal legal completeness. The
legacy documents are render sources while the published `legal_bundle_version` and
its per-module document rows are the immutable evidence for the exact contract
version.

## Legal rendering and provenance

Every canonical legal document stores:

- module key,
- source legal text version,
- rendered body,
- SHA-256 hash,
- origin,
- template key and template version,
- whether the tenant customized it,
- unresolved variables.

Platform-created default texts now carry explicit metadata:

```json
{
  "origin": "platform_template",
  "template_key": "consumer_terms",
  "template_version": "2026-07",
  "tenant_customized": false
}
```

Any unresolved required placeholder or missing required module blocks publication.
Locked legal bundle versions and their documents cannot be edited or deleted.

## One readiness source

`contract_publication_readiness_v` is the publication-level source. It returns:

- core publication blockers,
- display blockers,
- application blockers,
- tri-state `readiness_status`,
- `can_display`,
- `can_accept_applications`,
- exact legal modules and missing profile fields.

`gridex_tenant_contract_readiness_v` is the tenant aggregate used by the company UI.
It keeps “no published contracts” informational: the first contract is not blocked
because nothing has been published before it.

Unknown data is never presented as ready. Website display and customer application
acceptance are separate decisions, so an offer can remain visible while its CTA is
blocked.

## Customer contract, e-mail and PDF evidence

A customer contract stores direct references to the exact:

- contract publication version,
- price plan version,
- legal bundle version.

The database trigger also stores immutable tenant snapshots:

- legal contracting party,
- organization number and legal address,
- sender name/address and reply-to,
- support details,
- brand name/logo/colors/footer,
- publication/price/legal version IDs,
- snapshot hash.

The snapshot can refresh while a contract is unsigned. Once signed, active or locked,
the exact commercial/legal/tenant evidence is immutable.

Agreement e-mail and PDF generation prefer these locked snapshots. The PDF identifies
the tenant as contracting party and only describes Gridex as the technical platform,
not as the seller when another tenant owns the customer agreement.

## Legacy transition rules

The following remain only where needed as compatibility inputs or older internal
workflows:

```text
public_contract_offers
contract_offers
legal_bundles
legal_bundle_items
legal_text_versions
price_books
```

For the website and internal contract administration flows:

- no direct publish/update/delete is performed against the legacy offer tables from
  active UI code,
- website publication and both website/internal safe removal use canonical database
  commands,
- internal create/update uses the existing canonical versioning command,
- legal source bundle creation occurs inside the publication transaction,
- canonical immutable versions drive readiness and customer evidence.

Further physical removal of the compatibility tables should be a separate data
migration after external integrations and production data parity have been verified.

## Deployment order

1. Back up the database and deploy the migration
   `20260716140000_contract_legal_publication_single_source_completion.sql`.
2. Refresh generated Supabase types if your delivery process generates them from the
   live schema.
3. Deploy the application files.
4. Run the regression, type, test and production build commands in `SYNC_COMMANDS.md`.
5. Test one draft and one publication for private, business, monthly, hourly,
   quarterly, fixed, portfolio/mixed, POA on/off, renewal on/off and production on/off.
6. Verify an existing signed contract still renders its historical tenant, price and
   legal versions.

## Production verification queries

```sql
-- Tenant-level readiness
select *
from public.gridex_tenant_contract_readiness_v
where company_id = '<COMPANY_UUID>'::uuid;

-- Publication-level exact blockers
select contract_publication_version_id, readiness_status, blockers,
       display_blockers, application_blockers,
       can_display, can_accept_applications
from public.contract_publication_readiness_v
where company_id = '<COMPANY_UUID>'::uuid
order by valid_from desc nulls last;

-- Verify customer contract version locking
select id, status, signed_at, locked_at,
       contract_publication_version_id,
       price_plan_version_id,
       legal_bundle_version_id,
       tenant_communication_snapshot_sha256
from public.customer_contracts
where company_id = '<COMPANY_UUID>'::uuid
order by created_at desc
limit 20;

-- Verify there are no incomplete published legal evidence rows
select v.id, v.company_id, v.unresolved_variables,
       count(d.id) as document_count
from public.legal_bundle_versions v
left join public.legal_bundle_version_documents d
  on d.legal_bundle_version_id = v.id
where v.status = 'published'
group by v.id, v.company_id, v.unresolved_variables
having cardinality(coalesce(v.unresolved_variables, '{}')) > 0
    or count(d.id) = 0;
```

## Legal boundary

The implementation calculates, renders, versions and proves dynamic legal packages.
It does not replace substantive Swedish legal review. Production wording should be
approved by counsel competent in consumer law, electricity retail, distance
contracts, powers of attorney and microproduction before final use.
