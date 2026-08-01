import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapContractPublicationToPublicDto } from '@/lib/external-contracts/publicationDto'
import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'
import { ExternalTenantContextError } from '@/lib/integrations/tenantContext'
import { PUBLIC_API_ROUTES } from '@/lib/api/publicRouteRegistry'

const migrationPath =
  'supabase/migrations/20260731152000_public_contract_publication_graph_repair.sql'
const migration = readFileSync(migrationPath, 'utf8')
const adminContractsPage = readFileSync('app/admin/contracts/page.tsx', 'utf8')

describe('public contract publication graph repair', () => {
  it('removes the unsafe BEFORE trigger and inserts the parent before children', () => {
    expect(migration).toContain(
      'drop trigger if exists contract_publication_price_options_ready',
    )
    expect(migration).not.toContain(
      'create trigger contract_publication_price_options_ready',
    )

    const parentInsert = migration.indexOf(
      'insert into public.contract_publication_versions(',
    )
    const materialize = migration.indexOf(
      'perform public.gridex_finalize_contract_publication_v1(',
      parentInsert,
    )
    expect(parentInsert).toBeGreaterThan(0)
    expect(materialize).toBeGreaterThan(parentInsert)
  })

  it('keeps publication non-visible until finalization succeeds', () => {
    expect(migration).toContain(
      "values(v_assignment_id,v_channel,'draft',p_actor_user_id)",
    )
    expect(migration).toContain(
      "v_snapshot,v_offer_reference,v_hash,'draft',null,null,p_actor_user_id",
    )
    expect(migration).toContain("set status='published'")
    expect(migration).toContain('PUBLICATION_PRICE_OPTIONS_MISSING')
    expect(migration).toContain('PUBLICATION_AREA_PRICES_MISSING')
    expect(migration).toContain('PUBLICATION_LEGAL_BUNDLE_MISSING')
  })

  it('uses supported fixed-price areas instead of always requiring SE1-SE4', () => {
    expect(migration).toContain(
      'create or replace function public.gridex_supported_price_areas_v1',
    )
    expect(migration).toContain(
      "when cardinality(coalesce(v.price_areas,'{}'::text[]))>0",
    )
    expect(migration).toContain(
      "when v.contract_type='fixed' then array['SE1','SE2','SE3','SE4']::text[]",
    )
  })

  it('blocks invalid or duplicated declared price areas', () => {
    expect(migration).toContain('supported_areas_valid')
    expect(migration).toContain('PUBLICATION_SUPPORTED_PRICE_AREA_INVALID')
  })

  it('keeps exposure diagnostics aligned with publication selection and area rules', () => {
    expect(migration).toContain('required_selection_count')
    expect(migration).toContain(
      'PUBLICATION_PRICE_OPTION_SELECTION_POLICY_INVALID',
    )
    expect(migration).toContain(
      "area_row.unit in ('ore_per_kwh','sek_per_kwh')",
    )
    expect(migration).toContain('check(amount>=0) not valid')
    expect(migration).toContain('area_row.amount>=0')
  })

  it('separates strict exposure from broad LEFT JOIN diagnostics', () => {
    expect(migration).toContain(
      'create view public.canonical_visible_public_contracts_v',
    )
    expect(migration).toContain(
      'create view public.canonical_public_contract_diagnostics_v',
    )
    expect(migration).toContain(
      'left join public.tenant_contract_assignments assignment',
    )
    expect(migration).toContain(
      "with channels(channel) as (values('website'::text),('api'::text))",
    )
    expect(migration).toContain(
      "case when channel_id is null then upper(channel)||'_CHANNEL_MISSING' end",
    )
  })

  it('provides idempotent preview/apply functions and ETag invalidation', () => {
    expect(migration).toContain(
      'gridex_preview_public_contract_backfill_v1',
    )
    expect(migration).toContain(
      'gridex_apply_public_contract_backfill_v1',
    )
    expect(migration).toContain('PUBLICATION_BACKFILL_ACTOR_REQUIRED')
    expect(migration).toContain('on conflict do nothing')
    expect(migration).toContain(
      'trg_contract_price_options_publication_revision',
    )
    expect(migration).toContain(
      'trg_contract_price_option_area_publication_revision',
    )
  })


  it('blocks publication when invoice fee configuration is not canonical', () => {
    expect(migration).toContain(
      'create or replace function public.gridex_invoice_fee_ready_v1',
    )
    expect(migration).toContain('INVOICE_FEE_CONFIGURATION_MISSING')
    expect(migration).toContain('invoice_fee_ready')
  })

  it('reports missing publication versions and isolates unsafe backfill candidates', () => {
    expect(migration).toContain('MANUAL_CHANNEL_OR_PUBLICATION_REVIEW')
    expect(migration).toContain("when c.publication_version_id is null then 'PUBLICATION_VERSION_MISSING'")
    expect(migration).toMatch(
      /when sqlstate '23503'\s+or sqlstate '23505'\s+or sqlstate '23514'/,
    )
    expect(migration).toContain("'PUBLICATION_BACKFILL_APPLY_BLOCKED'")
  })

  it('is self-contained for a partially applied historical migration', () => {
    expect(migration).toContain(
      'add column if not exists contract_publication_version_id uuid',
    )
    expect(migration).toContain(
      'gridex_assert_price_option_snapshot_unique_v1',
    )
    expect(migration).toContain('PUBLICATION_PRICE_OPTION_DUPLICATE')
  })


  it('preserves commercial locks and only allows relation-policy completion', () => {
    expect(migration).toContain(
      'create or replace function public.gridex_lock_commercial_child()',
    )
    expect(migration).toContain('locked_commercial_pricing_is_immutable')
    expect(migration).toContain(
      'gridex_assert_area_price_snapshot_unique_v1',
    )
  })

  it('repairs locked derived snapshots without permitting commercial changes', () => {
    expect(migration).toContain("current_setting('gridex.publication_graph_repair',true)")
    expect(migration).toContain('locked_publication_commercial_snapshot_is_immutable')
    expect(migration).toContain('PUBLICATION_PRICE_OPTION_SNAPSHOT_MISMATCH')
    expect(migration).toContain("'commercial_values_changed',false")
  })

  it('refuses ambiguous prior publication price sources', () => {
    expect(migration).toContain('v_prior_graph_count')
    expect(migration).toContain("message='PUBLICATION_PRICE_SOURCE_AMBIGUOUS'")
  })

  it('requires the publication snapshot to point at the exact source offer', () => {
    expect(migration).toContain('snapshot_source_contract_offer_id')
    expect(migration).toContain('PUBLICATION_SOURCE_OFFER_MISMATCH')
    expect(migration).toContain("then 'blocked'")
  })

  it('copies missing area relations only from an identical stable template', () => {
    expect(migration).toContain("'materialized_source_kind','template_reference_match'")
    expect(migration).toContain('source.option_reference=target.option_reference')
    expect(migration).toContain("coalesce(source.metadata->>'fixed_price','')=coalesce(target.metadata->>'fixed_price','')")
  })


  it('restores every missing template option without moving snapshot rows', () => {
    expect(migration).toContain('template_missing_count')
    expect(migration).toContain('RESTORE_TEMPLATE_COPY')
    expect(migration).toContain(
      'restored_from_publication_price_option_id',
    )
  })

  it('shows canonical website and API channel states and blockers in admin', () => {
    expect(adminContractsPage).toContain(
      'canonical_public_contract_diagnostics_v',
    )
    expect(adminContractsPage).toContain('publicContractChannelStateLabel')
    expect(adminContractsPage).toContain('Blockerare:')
  })

  it('publishes canonical and deprecated API routes with separate diagnostic scope', () => {
    expect(PUBLIC_API_ROUTES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/api/v1/public-contracts',
          scopes: ['api_contracts.read'],
        }),
        expect.objectContaining({
          path: '/api/v1/public-contracts/diagnostics',
          scopes: ['api_contracts.diagnostics'],
        }),
        expect.objectContaining({ path: '/api/v1/contracts' }),
      ]),
    )
  })

  it('returns explicit tenant and schema error classifications', () => {
    expect(
      classifyPublicContractsError(
        new ExternalTenantContextError({
          status: 409,
          code: 'EXTERNAL_TENANT_REFERENCE_MISSING',
          message: 'Tenantens externa referens saknas.',
        }),
      ),
    ).toMatchObject({
      status: 409,
      code: 'EXTERNAL_TENANT_REFERENCE_MISSING',
    })
    expect(
      classifyPublicContractsError({
        code: '42P01',
        message: 'relation does not exist',
      }),
    ).toMatchObject({
      status: 503,
      code: 'PUBLIC_CONTRACT_SCHEMA_OUTDATED',
      databaseCode: '42P01',
    })
  })

  it('publishes canonical top-level price_options without internal IDs', () => {
    const bundleId = '00000000-0000-4000-8000-000000000010'
    const dto = mapContractPublicationToPublicDto({
      channel: 'api',
      companyId: '00000000-0000-4000-8000-000000000001',
      publication: {
        offer_reference: 'offer_fixed_se3',
        name: 'Fast SE3',
        contract_type: 'fixed',
        energy_direction: 'consumption',
        customer_type: 'private',
        price_options: [
          {
            id: 'internal-option-id',
            price_option_reference: 'fixed_12_se3',
            option_code: 'fixed_12',
            customer_name: 'Fastpris 12 månader',
            price_type: 'fixed',
            contract_type: 'fixed',
            customer_type: 'private',
            resolution: 'monthly',
            currency: 'SEK',
            unit: 'ore_per_kwh',
            fixed_price: 112,
            markup: null,
            monthly_fee: 49,
            binding_months: 12,
            notice_months: 1,
            auto_renew_enabled: false,
            renewal_term_months: null,
            is_default: true,
            default: true,
            selection_required: false,
            valid_from: null,
            valid_to: null,
            earliest_start_date: null,
            latest_start_date: null,
            area_prices: [
              {
                id: 'internal-area-id',
                area_price_reference: 'fixed_12_se3',
                price_area: 'SE3',
                energy_price_ore_per_kwh: 112,
                unit: 'ore_per_kwh',
                valid_from: null,
                valid_to: null,
              },
            ],
          },
        ],
        pricing: {},
        legal: {
          legal_bundle_version_id: bundleId,
          immutable: true,
          module_versions: [
            {
              id: '00000000-0000-4000-8000-000000000011',
              legal_bundle_version_id: bundleId,
              module_key: 'general_consumer_terms',
              version: '2',
              title: 'Allmänna konsumentvillkor',
              published_at: null,
              content_sha256: null,
              origin: 'canonical_bundle_document',
            },
          ],
        },
      },
    })

    expect(dto.price_options).toEqual([
      expect.objectContaining({
        price_option_reference: 'fixed_12_se3',
        is_default: true,
        default: true,
        area_prices: [
          expect.objectContaining({ area_price_reference: 'fixed_12_se3' }),
        ],
      }),
    ])
    expect(JSON.stringify(dto)).not.toContain('internal-option-id')
    expect(JSON.stringify(dto)).not.toContain('internal-area-id')
    expect(dto.legal).toMatchObject({
      legal_bundle_version_id: bundleId,
      module_versions: [
        expect.objectContaining({ legal_bundle_version_id: bundleId }),
      ],
    })
  })
})
