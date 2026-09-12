import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const io = vi.hoisted(() => {
  type DbResult = {
    data: unknown
    error: null | { code?: string; message: string }
    count?: number
  }
  type DbCall = {
    table: string
    operation: 'select' | 'insert' | 'update'
    payload: unknown
    filters: Record<string, unknown>
  }
  type Query = PromiseLike<DbResult> & {
    select: (columns?: string) => Query
    insert: (payload: unknown) => Query
    update: (payload: unknown) => Query
    eq: (column: string, value: unknown) => Query
    is: (column: string, value: unknown) => Query
    in: (column: string, value: unknown[]) => Query
    not: (column: string, operator: string, value: unknown) => Query
    limit: (count: number) => Query
    order: (column: string, options?: unknown) => Query
    range: (from: number, to: number) => Query
    maybeSingle: () => Promise<DbResult>
    single: () => Promise<DbResult>
  }

  const state = {
    dbCalls: [] as DbCall[],
    rpcCalls: [] as Array<{ name: string; input: Record<string, unknown> }>,
    portalReplay: false,
    portalRequestHash: null as string | null,
    websiteQuote: null as Record<string, unknown> | null,
  }

  function resultFor(call: DbCall): DbResult {
    state.dbCalls.push({ ...call, filters: { ...call.filters } })
    if (call.table === 'companies') {
      return { data: { slug: 'fixture', company_slug: 'fixture' }, error: null }
    }
    if (call.table === 'canonical_public_contract_delivery_readiness_v') {
      return {
        data: [{
          company_id: 'company-A',
          customer_type: 'both',
          channel: 'website',
          publication_version_id: 'publication-version-A',
          public_offer_id: 'offer-row-A',
          visible: true,
          canonical_graph_consistent: true,
          forward_publication_link_valid: true,
          reverse_legacy_link_valid: true,
          company_chain_valid: true,
          tenant_assignment_valid: true,
          channel_graph_valid: true,
          product_version_valid: true,
          source_offer_consistent: true,
          snapshot_hash_valid: true,
          energy_direction_valid: true,
          contract_type_valid: true,
          successor_chain_valid: true,
        }],
        error: null,
      }
    }
    if (call.table === 'canonical_visible_public_contracts_v') {
      return {
        data: [{
          id: 'offer-row-A',
          company_id: 'company-A',
          price_plan_id: 'price-plan-A',
          price_plan_version_id: 'price-plan-version-A',
          product_code: 'gridex_fixed',
          public_name: 'Gridex Fast',
          contract_type: 'fixed',
          billing_model: 'fixed',
          customer_type: 'both',
          monthly_fee_sek: 0,
          invoice_fee_sek: 0,
          fixed_price_ore_per_kwh: 100,
          terms_version: 'fixture-v1',
          sort_order: 1,
          publication_status: 'published',
          website_enabled: true,
          website_cta_enabled: true,
          is_archived: false,
          canonical_offer_reference: 'offer-fixture',
          contract_product_id: 'product-A',
          contract_product_version_id: 'product-version-A',
          contract_publication_version_id: 'publication-version-A',
          legal_bundle_version_id: 'legal-bundle-version-A',
          price_book_id: 'price-book-A',
          price_areas: ['SE3'],
          canonical_metadata: {},
          canonical_pricing_snapshot: {
            snapshot_schema: 'gridex_contract_pricing_v6_selection',
            pricing_model: 'fixed',
            vat_rate: 0.25,
            invoice_delivery_methods: ['email'],
            commercial_components: [],
            base_components: [{
              source_type: 'fixed',
              label: 'Fast pris',
              weight_percent: 100,
              fixed_price_sek_per_kwh: 1,
              price_area: 'SE3',
            }],
            price_components: [{
              component_code: 'invoice_fee',
              component_type: 'invoice_fee',
              name: 'Fakturaavgift',
              amount: 0,
              calculation_type: 'per_invoice',
              unit: 'sek_invoice',
              status: 'active',
            }],
          },
        }],
        error: null,
      }
    }
    if (call.table === 'contract_publication_readiness_v') {
      return {
        data: [{
          contract_publication_version_id: 'publication-version-A',
          company_id: 'company-A',
          status: 'published',
          locked_at: '2026-09-12T00:00:00.000Z',
          blockers: [],
        }],
        error: null,
      }
    }
    if (call.table === 'legal_bundle_versions') {
      return {
        data: [{
          id: 'legal-bundle-version-A',
          status: 'published',
          published_at: '2026-09-12T00:00:00.000Z',
          locked_at: '2026-09-12T00:00:00.000Z',
        }],
        error: null,
      }
    }
    if (call.table === 'legal_bundle_version_documents') {
      return {
        data: [{
          id: 'legal-document-A',
          legal_bundle_version_id: 'legal-bundle-version-A',
          module_key: 'general_consumer_terms',
          title: 'Allmanna villkor',
          template_version: 'fixture-v1',
          content_sha256: 'b'.repeat(64),
          origin: 'canonical_bundle_document',
          created_at: '2026-09-12T00:00:00.000Z',
          sort_order: 1,
          unresolved_variables: [],
        }],
        error: null,
      }
    }
    if (call.table === 'contract_price_options') {
      return {
        data: [{
          id: 'price-option-row-A',
          company_id: 'company-A',
          contract_product_version_id: 'product-version-A',
          price_plan_version_id: 'price-plan-version-A',
          contract_publication_version_id: 'publication-version-A',
          option_reference: 'option-fixture',
          option_code: 'fixed-fixture',
          customer_name: 'Fast pris',
          contract_type: 'fixed',
          customer_type: 'both',
          binding_months: 12,
          notice_months: 1,
          auto_renew_enabled: false,
          renewal_term_months: null,
          is_default: true,
          selection_required: false,
          valid_from: null,
          valid_to: null,
          status: 'active',
          sort_order: 1,
          metadata: { resolution: 'monthly', fixed_price: 100, monthly_fee: 0 },
        }],
        error: null,
      }
    }
    if (call.table === 'contract_price_option_area_prices') {
      return {
        data: [{
          contract_price_option_id: 'price-option-row-A',
          price_row_reference: 'area-price-SE3',
          price_area: 'SE3',
          amount: 100,
          unit: 'ore_per_kwh',
          valid_from: null,
          valid_to: null,
          status: 'active',
        }],
        error: null,
      }
    }
    if (call.table === 'platform_runtime_readiness') {
      return {
        data: {
          is_ready: true,
          schema_version: '20260803093300-gridex-runtime-readiness-v3',
          schema_fingerprint: 'a'.repeat(64),
          blocking_issues: [],
          capabilities: {},
        },
        error: null,
      }
    }
    if (call.table === 'tenant_portal_customer_links') {
      return {
        data: {
          id: 'portal-link-A',
          company_id: 'company-A',
          customer_id: 'customer-A',
          provider: 'fixture',
          external_customer_id: 'external-customer-A',
          status: 'active',
        },
        error: null,
      }
    }
    if (call.table === 'customers') {
      return {
        data: {
          id: 'customer-A',
          company_id: 'company-A',
          customer_number: '10001',
          external_customer_id: 'external-customer-A',
          customer_type: 'private',
          status: 'active',
          first_name: 'Test',
          last_name: 'Customer',
          full_name: 'Test Customer',
          email: 'customer@example.test',
          phone: null,
          created_at: '2026-09-12T00:00:00.000Z',
        },
        error: null,
      }
    }
    if (call.table === 'customer_profiles') {
      return { data: null, error: null }
    }
    if (call.table === 'customer_site_resolution') {
      if (call.operation === 'insert') {
        return { data: { id: '00000000-0000-4000-8000-000000000001' }, error: null }
      }
      return {
        data: {
          id: '00000000-0000-4000-8000-000000000001',
          company_id: 'company-A',
          price_area: 'SE3',
          price_area_assurance_status: 'estimated',
          price_area_assurance_source: 'postal_consensus',
          price_area_assurance_confidence: 0.85,
          price_area_assurance_source_version: 'fixture',
          price_area_candidate_count: 1,
          price_area_unique_count: 1,
          price_area_evidence: {},
          grid_area_code: null,
          grid_area_name: null,
          grid_owner_id: null,
          grid_owner_name: 'Grid owner',
          resolution_status: 'postal_suggested',
          confidence: 0.85,
          automation_allowed: false,
          resolved_at: '2026-09-12T00:00:00.000Z',
          expires_at: '2030-09-12T00:00:00.000Z',
          resolver_version: 'fixture',
          geodata_version: 'fixture',
          source_chain: [
            'postal_code',
            'platform_postal_code_grid_mappings',
            'postal_price_area_consensus',
            'platform_grid_areas',
          ],
          conflict_code: null,
          created_at: '2026-09-12T00:00:00.000Z',
        },
        error: null,
      }
    }
    if (call.table === 'platform_postal_code_grid_mappings') {
      return {
        data: [{
          postal_code: '11122',
          city: 'Stockholm',
          grid_area_code: 'STH',
          price_area: 'SE3',
          confidence: 1,
          source: 'fixture-catalog',
          updated_at: '2026-09-12T00:00:00.000Z',
        }],
        error: null,
        count: 1,
      }
    }
    if (call.table === 'platform_grid_areas') {
      const row = {
        id: 'platform-grid-area-A',
        grid_area_code: 'STH',
        grid_area_name: 'Stockholm',
        grid_owner_id: 'platform-grid-owner-A',
        grid_owner_name: 'Grid owner',
        price_area: 'SE3',
        platform_grid_owners: {
          name: 'Grid owner',
          ops_grid_owner_id: 'grid-owner-A',
        },
      }
      return {
        data: Array.isArray(call.filters.grid_area_code) ? [row] : row,
        error: null,
      }
    }
    if (call.table === 'gridex_verified_grid_owners_v') {
      return {
        data: [{
          grid_owner_id: 'grid-owner-A',
          name: 'Grid owner',
          ediel_id: 'GRIDOWNER',
          org_number: '5560000000',
          verification_status: 'verified',
          certificate_status: 'finns',
          verified_for_customer_flow: true,
          route_count: 1,
          prodat_route_count: 1,
          utilts_route_count: 1,
          duplicate_count: 0,
          verification_reasons: [],
          next_action: null,
          prodat_subaddress_status: 'verified',
          utilts_subaddress_status: 'verified',
          prodat_subaddress_source: 'fixture',
          utilts_subaddress_source: 'fixture',
          can_use_for_prodat: true,
          can_use_for_utilts: true,
          can_start_supplier_switch: true,
        }],
        error: null,
      }
    }
    if (call.table === 'customer_portal_write_idempotency') {
      if (call.operation === 'insert') {
        const payload = call.payload as { request_hash?: unknown } | null
        state.portalRequestHash = String(payload?.request_hash ?? '')
        if (state.portalReplay) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }
        }
      }
      if (state.portalReplay && call.operation === 'select') {
        return {
          data: {
            id: 'portal-idempotency-A',
            status: 'completed',
            response_status: 200,
            response_body: {
              data: {
                updated_count: 1,
                notification_references: [],
                read_at: '2026-09-12T00:00:00.000Z',
              },
            },
            request_hash: state.portalRequestHash,
            started_at: '2026-09-12T00:00:00.000Z',
          },
          error: null,
        }
      }
      return { data: { id: 'portal-idempotency-A' }, error: null }
    }
    if (call.table === 'integration_api_write_idempotency') {
      return { data: { id: 'integration-idempotency-A' }, error: null }
    }
    if (call.table === 'customer_notifications') {
      return { data: [{ id: 'notification-row-A' }], error: null }
    }
    if (call.table === 'website_contract_quotes') {
      if (call.operation === 'insert') {
        state.websiteQuote = {
          id: 'website-quote-row-A',
          ...(call.payload as Record<string, unknown>),
          consumed_at: null,
          consumed_application_id: null,
          created_at: '2026-09-12T00:00:00.000Z',
        }
        return { data: { id: 'website-quote-row-A' }, error: null }
      }
      return { data: state.websiteQuote, error: null }
    }
    return { data: null, error: null }
  }

  const from = vi.fn((table: string): Query => {
    const call: DbCall = {
      table,
      operation: 'select',
      payload: null,
      filters: {},
    }
    const query: Query = {
      select: () => query,
      insert: (payload) => {
        call.operation = 'insert'
        call.payload = payload
        return query
      },
      update: (payload) => {
        call.operation = 'update'
        call.payload = payload
        return query
      },
      eq: (column, value) => {
        call.filters[column] = value
        return query
      },
      is: (column, value) => {
        call.filters[column] = value
        return query
      },
      in: (column, value) => {
        call.filters[column] = value
        return query
      },
      not: (column, operator, value) => {
        call.filters[column] = { operator, value }
        return query
      },
      limit: () => query,
      order: () => query,
      range: (from, to) => {
        call.filters.__range = [from, to]
        return query
      },
      maybeSingle: async () => resultFor(call),
      single: async () => resultFor(call),
      then: <TResult1 = DbResult, TResult2 = never>(
        onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(resultFor(call)).then(onfulfilled, onrejected),
    }
    return query
  })

  const rpc = vi.fn(
    async (name: string, input: Record<string, unknown>): Promise<DbResult> => {
      state.rpcCalls.push({ name, input })
      if (name === 'authenticate_integration_request_v1') {
        return {
          data: {
            auth_outcome: 'allowed',
            error_code: null,
            tenant_status: 'active',
            client_id: 'client-A',
            company_id: 'company-A',
            client_name: 'Strict schema fixture',
            client_status: 'active',
            key_prefix: 'integration-',
            secret_hash: 'hash',
            scopes: [
              'customer_notifications.write',
              'website_quotes.write',
              'website_quotes.validate',
            ],
            allowed_ips: [],
            allowed_origins: [],
            metadata: { partner_default_offer_reference: 'offer-fixture' },
            rate_limit_per_minute: 100,
            expires_at: null,
            request_count: 1,
            route_limit: 100,
            reset_at: '2026-09-12T00:01:00.000Z',
          },
          error: null,
        }
      }
      if (name === 'resolve_portal_customer_identity_v1') {
        return { data: [], error: null }
      }
      return { data: null, error: null }
    },
  )

  return {
    state,
    from,
    rpc,
    scheduleUsageEvent: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: io.from, rpc: io.rpc },
}))
vi.mock('@/lib/audit/actionLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit/actionLogger')>()
  return { ...actual, scheduleUsageEvent: io.scheduleUsageEvent }
})

import { POST as notificationRead } from '@/app/api/v1/customer/notifications/read/route'
import { POST as createWebsiteQuote } from '@/app/api/v1/website/quote/route'
import { POST as validateWebsiteQuoteRoute } from '@/app/api/v1/website/quote/validate/route'
import { POST as partnerPost } from '@/app/api/partner/v1/[[...path]]/route'
import { publicReference } from '@/lib/integrations/publicReferences'

const RESOLUTION_ID = '00000000-0000-4000-8000-000000000001'

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer integration-token',
    'idempotency-key': 'task-10b1-idempotency',
    ...extra,
  }
}

function jsonRequest(input: {
  url: string
  body?: Record<string, unknown>
  raw?: string
  headers?: Record<string, string>
}) {
  return new NextRequest(input.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(input.headers),
    },
    body: input.raw ?? JSON.stringify(input.body ?? {}),
  })
}

function quoteBody() {
  return {
    resolution_id: RESOLUTION_ID,
    offer_reference: 'offer-fixture',
    customer_type: 'private',
    annual_consumption_kwh: 3500,
    start_date: '2026-09-15',
    price_option_reference: 'option-fixture',
    invoice_delivery_method: 'email',
    selected_component_references: [],
    site_count: 1,
  }
}

function validationBody() {
  return {
    quote_reference: 'quote_strict_schema_fixture_1234567890',
    ...quoteBody(),
  }
}

function authCalls() {
  return io.state.rpcCalls.filter(
    (call) => call.name === 'authenticate_integration_request_v1',
  )
}

function idempotencyCalls() {
  return io.state.dbCalls.filter((call) =>
    call.table === 'customer_portal_write_idempotency' ||
    call.table === 'integration_api_write_idempotency',
  )
}

function websiteQuoteCalls() {
  return io.state.dbCalls.filter((call) => call.table === 'website_contract_quotes')
}

function publicationCalls() {
  return io.state.dbCalls.filter((call) =>
    call.table === 'canonical_public_contract_delivery_readiness_v' ||
    call.table === 'canonical_visible_public_contracts_v',
  )
}

function resolverDbCalls() {
  const resolverTables = new Set([
    'platform_postal_code_grid_mappings',
    'platform_grid_areas',
    'gridex_verified_grid_owners_v',
    'platform_grid_owners',
    'platform_address_lookup_cache',
    'energy_geodata_versions',
    'customer_site_resolution',
  ])
  return io.state.dbCalls.filter((call) => resolverTables.has(call.table))
}

function assertCanonicalError(
  payload: unknown,
  expected: {
    code: string
    message: string
    field: string
    details?: Record<string, unknown>
  },
) {
  const body = payload as Record<string, unknown>
  expect(Object.keys(body).sort()).toEqual([
    'contract_schema_version',
    'correlation_id',
    'error',
    'request_id',
  ])
  expect(body.error).toEqual({
    code: expected.code,
    message: expected.message,
    retryable: false,
    field: expected.field,
    blockers: [],
    ...(expected.details === undefined ? {} : { details: expected.details }),
  })
  expect(body.request_id).toEqual(expect.any(String))
  expect(body.correlation_id).toBe(body.request_id)
}

beforeEach(() => {
  vi.clearAllMocks()
  io.state.dbCalls = []
  io.state.rpcCalls = []
  io.state.portalReplay = false
  io.state.portalRequestHash = null
  io.state.websiteQuote = null
})

describe('strict notification and pricing request schemas', () => {
  it('rejects changed notification unknown fields before the canonical claim', async () => {
    const notification = publicReference(
      'notification',
      'company-A',
      'notification-row-A',
    ) as string

    for (const unexpected of [true, false]) {
      const response = await notificationRead(jsonRequest({
        url: 'https://app.gridex.se/api/v1/customer/notifications/read',
        headers: { 'x-gridex-external-customer-id': 'external-customer-A' },
        body: {
          notification_references: [notification],
          unexpected,
        },
      }))
      expect(response.status).toBe(400)
      assertCanonicalError(await response.json(), {
        code: 'unknown_field',
        message: 'Förfrågan innehåller fält som inte ingår i API-kontraktet.',
        field: 'unexpected',
      })
    }

    expect(idempotencyCalls()).toHaveLength(0)
    expect(io.state.dbCalls.some((call) =>
      call.table === 'customer_notifications' && call.operation === 'update',
    )).toBe(false)
  })

  it('keeps a valid notification read tenant-bound and idempotent', async () => {
    const notification = publicReference(
      'notification',
      'company-A',
      'notification-row-A',
    ) as string
    const response = await notificationRead(jsonRequest({
      url: 'https://app.gridex.se/api/v1/customer/notifications/read',
      headers: { 'x-gridex-external-customer-id': 'external-customer-A' },
      body: { notification_references: [notification] },
    }))

    expect(response.status).toBe(200)
    expect(authCalls()).toHaveLength(1)
    expect(authCalls()[0].input).toMatchObject({
      p_required_all: ['customer_notifications.write'],
    })
    expect(idempotencyCalls()).toContainEqual(expect.objectContaining({
      table: 'customer_portal_write_idempotency',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        api_client_id: 'client-A',
        customer_id: 'customer-A',
      }),
    }))
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'customer_notifications',
      operation: 'select',
      filters: expect.objectContaining({ __range: [0, 999] }),
    }))
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'customer_notifications',
      operation: 'update',
      filters: expect.objectContaining({
        company_id: 'company-A',
        customer_id: 'customer-A',
      }),
    }))
  })

  it('keeps canonical notification replay after strict root validation', async () => {
    io.state.portalReplay = true
    const notification = publicReference(
      'notification',
      'company-A',
      'notification-row-A',
    ) as string
    const response = await notificationRead(jsonRequest({
      url: 'https://app.gridex.se/api/v1/customer/notifications/read',
      headers: { 'x-gridex-external-customer-id': 'external-customer-A' },
      body: { notification_references: [notification] },
    }))

    expect(response.status).toBe(200)
    expect(idempotencyCalls()).toHaveLength(2)
    expect(io.state.dbCalls.some((call) =>
      call.table === 'customer_notifications',
    )).toBe(false)
    expect(await response.json()).toMatchObject({
      data: { updated_count: 1 },
    })
  })

  it('rejects every non-positive finite JSON-number representation before quote claim', async () => {
    const invalid = [
      ['numeric string', '"3500"'],
      ['comma string', '"3500,5"'],
      ['boolean', 'true'],
      ['null', 'null'],
      ['array', '[3500]'],
      ['object', '{"value":3500}'],
      ['zero', '0'],
      ['negative', '-1'],
      ['overlarge numeric token', '1e309'],
    ] as const

    for (const [name, rawValue] of invalid) {
      io.state.dbCalls = []
      const raw = JSON.stringify(quoteBody()).replace('3500', rawValue)
      const response = await createWebsiteQuote(jsonRequest({
        url: 'https://app.gridex.se/api/v1/website/quote',
        raw,
      }))
      expect(response.status, name).toBe(400)
      assertCanonicalError(await response.json(), {
        code: 'invalid_quote_input',
        message: 'Årsförbrukning måste vara större än 0.',
        field: 'annual_consumption_kwh',
      })
      expect(publicationCalls(), name).toHaveLength(0)
      expect(websiteQuoteCalls(), name).toHaveLength(0)
      expect(idempotencyCalls(), name).toHaveLength(0)
    }
  })

  it('rejects every non-safe-positive JSON integer before quote claim', async () => {
    const invalid = [
      ['numeric string', '"1"'],
      ['boolean', 'true'],
      ['null', 'null'],
      ['array', '[1]'],
      ['object', '{"value":1}'],
      ['zero', '0'],
      ['negative', '-1'],
      ['fraction', '1.9'],
      ['unsafe integer', '9007199254740992'],
      ['overlarge numeric token', '1e309'],
    ] as const

    for (const [name, rawValue] of invalid) {
      io.state.dbCalls = []
      const raw = JSON.stringify(quoteBody()).replace(
        '"site_count":1',
        `"site_count":${rawValue}`,
      )
      const response = await createWebsiteQuote(jsonRequest({
        url: 'https://app.gridex.se/api/v1/website/quote',
        raw,
      }))
      expect(response.status, name).toBe(400)
      assertCanonicalError(await response.json(), {
        code: 'invalid_site_count',
        message: 'site_count måste vara ett heltal större än 0.',
        field: 'site_count',
      })
      expect(publicationCalls(), name).toHaveLength(0)
      expect(websiteQuoteCalls(), name).toHaveLength(0)
      expect(idempotencyCalls(), name).toHaveLength(0)
    }
  })

  it('keeps valid website quote numbers tenant-bound through claim and pricing', async () => {
    const response = await createWebsiteQuote(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote',
      body: quoteBody(),
    }))

    expect(response.status).toBe(201)
    expect(authCalls()).toHaveLength(1)
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'customer_site_resolution',
      operation: 'select',
      filters: expect.objectContaining({ id: RESOLUTION_ID }),
    }))
    expect(websiteQuoteCalls()).toContainEqual(expect.objectContaining({
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        api_client_id: 'client-A',
        annual_consumption_kwh: 3500,
        site_count: 1,
      }),
    }))
    expect(idempotencyCalls()).toContainEqual(expect.objectContaining({
      table: 'integration_api_write_idempotency',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        api_client_id: 'client-A',
      }),
    }))
  })

  it('retains the existing missing-field roles around strict numeric validation', async () => {
    const missingSite = quoteBody()
    delete (missingSite as { site_count?: number }).site_count
    let response = await createWebsiteQuote(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote',
      body: missingSite,
    }))
    expect(response.status).toBe(400)
    assertCanonicalError(await response.json(), {
      code: 'missing_field',
      message: 'Förfrågan saknar obligatoriska kommersiella fält.',
      field: 'site_count',
      details: { missing_fields: ['site_count'] },
    })

    const missingConsumption = quoteBody()
    delete (missingConsumption as { annual_consumption_kwh?: number })
      .annual_consumption_kwh
    response = await createWebsiteQuote(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote',
      body: missingConsumption,
    }))
    expect(response.status).toBe(400)
    assertCanonicalError(await response.json(), {
      code: 'invalid_quote_input',
      message: 'Årsförbrukning måste vara större än 0.',
      field: 'annual_consumption_kwh',
    })

    const missingAssertion = validationBody()
    delete (missingAssertion as { annual_consumption_kwh?: number })
      .annual_consumption_kwh
    response = await validateWebsiteQuoteRoute(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote/validate',
      body: missingAssertion,
    }))
    expect(response.status).toBe(400)
    assertCanonicalError(await response.json(), {
      code: 'missing_field',
      message: 'Payloaden saknar obligatoriska quote-assertioner.',
      field: 'annual_consumption_kwh',
      details: { missing_fields: ['annual_consumption_kwh'] },
    })
    expect(idempotencyCalls()).toHaveLength(0)
  })

  it('rejects malformed quote assertions before validation business I/O', async () => {
    const invalid = [
      ['annual_consumption_kwh', '3500', '"3500"'],
      ['annual_consumption_kwh', '3500', '"3500,5"'],
      ['annual_consumption_kwh', '3500', 'true'],
      ['annual_consumption_kwh', '3500', 'null'],
      ['annual_consumption_kwh', '3500', '[3500]'],
      ['annual_consumption_kwh', '3500', '{"value":3500}'],
      ['annual_consumption_kwh', '3500', '0'],
      ['annual_consumption_kwh', '3500', '-1'],
      ['annual_consumption_kwh', '3500', '1e309'],
      ['site_count', '"site_count":1', '"site_count":"1"'],
      ['site_count', '"site_count":1', '"site_count":true'],
      ['site_count', '"site_count":1', '"site_count":null'],
      ['site_count', '"site_count":1', '"site_count":[1]'],
      ['site_count', '"site_count":1', '"site_count":{"value":1}'],
      ['site_count', '"site_count":1', '"site_count":0'],
      ['site_count', '"site_count":1', '"site_count":-1'],
      ['site_count', '"site_count":1', '"site_count":1.9'],
      ['site_count', '"site_count":1', '"site_count":9007199254740992'],
      ['site_count', '"site_count":1', '"site_count":1e309'],
    ] as const

    for (const [field, target, replacement] of invalid) {
      io.state.dbCalls = []
      const response = await validateWebsiteQuoteRoute(jsonRequest({
        url: 'https://app.gridex.se/api/v1/website/quote/validate',
        raw: JSON.stringify(validationBody()).replace(target, replacement),
      }))
      expect(response.status, `${field}:${replacement}`).toBe(400)
      assertCanonicalError(await response.json(), {
        code: 'invalid_quote_assertion',
        message: field === 'annual_consumption_kwh'
          ? 'annual_consumption_kwh måste vara ett tal större än 0.'
          : 'site_count måste vara ett heltal större än 0.',
        field,
      })
      expect(publicationCalls()).toHaveLength(0)
      expect(websiteQuoteCalls()).toHaveLength(0)
      expect(idempotencyCalls()).toHaveLength(0)
    }
  })

  it('keeps valid quote validation numerical, tenant-bound and non-idempotent', async () => {
    const createdResponse = await createWebsiteQuote(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote',
      body: quoteBody(),
    }))
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as {
      data: { quote_reference: string }
    }

    io.state.dbCalls = []
    io.state.rpcCalls = []
    const response = await validateWebsiteQuoteRoute(jsonRequest({
      url: 'https://app.gridex.se/api/v1/website/quote/validate',
      body: {
        ...validationBody(),
        quote_reference: created.data.quote_reference,
      },
    }))

    expect(response.status).toBe(200)
    expect(authCalls()).toHaveLength(1)
    expect(websiteQuoteCalls()).toContainEqual(expect.objectContaining({
      operation: 'select',
      filters: expect.objectContaining({
        company_id: 'company-A',
        quote_reference: created.data.quote_reference,
      }),
    }))
    expect(websiteQuoteCalls().some((call) => call.operation !== 'select')).toBe(false)
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'canonical_energy_flow_events',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        event_type: 'quote.validated',
      }),
    }))
    expect(idempotencyCalls()).toHaveLength(0)
  })

  it('rejects partner price coercions before resolution and pricing effects', async () => {
    const invalid = [
      ['numeric string', '"3500"'],
      ['comma string', '"3500,5"'],
      ['boolean', 'true'],
      ['null', 'null'],
      ['array', '[3500]'],
      ['object', '{"value":3500}'],
      ['zero', '0'],
      ['negative', '-1'],
      ['overlarge numeric token', '1e309'],
    ] as const

    for (const [name, annualConsumption] of invalid) {
      io.state.rpcCalls = []
      io.state.dbCalls = []
      const response = await partnerPost(
        jsonRequest({
          url: 'https://app.gridex.se/api/partner/v1/price',
          raw: `{"postal_code":"11122","annual_consumption_kwh":${annualConsumption}}`,
          headers: { 'x-request-id': `partner-${name.replaceAll(' ', '-')}` },
        }),
        { params: Promise.resolve({ path: ['price'] }) },
      )
      expect(response.status, name).toBe(422)
      expect(await response.json()).toEqual({
        error: {
          code: 'annual_consumption_invalid',
          message: 'annual_consumption_kwh must be greater than 0.',
          field: 'annual_consumption_kwh',
        },
        request_id: `partner-${name.replaceAll(' ', '-')}`,
      })
      expect(authCalls(), name).toHaveLength(1)
      expect(resolverDbCalls(), name).toHaveLength(0)
      expect(publicationCalls(), name).toHaveLength(0)
      expect(websiteQuoteCalls(), name).toHaveLength(0)
    }
  })

  it('keeps valid partner price dispatch and credential company binding', async () => {
    const response = await partnerPost(
      jsonRequest({
        url: 'https://app.gridex.se/api/partner/v1/price',
        body: { postal_code: '11122', annual_consumption_kwh: 3500 },
        headers: { 'x-request-id': 'partner-valid' },
      }),
      { params: Promise.resolve({ path: ['price'] }) },
    )

    expect(response.status).toBe(200)
    expect(authCalls()).toHaveLength(1)
    expect(authCalls()[0].input).toMatchObject({
      p_required_any: [
        'website_quotes.write',
        'customer_contracts.read',
        'partner_contracts.write',
      ],
    })
    expect(resolverDbCalls()).toContainEqual(expect.objectContaining({
      table: 'platform_postal_code_grid_mappings',
      operation: 'select',
      filters: expect.objectContaining({ postal_code: '11122' }),
    }))
    expect(resolverDbCalls()).toContainEqual(expect.objectContaining({
      table: 'gridex_verified_grid_owners_v',
      operation: 'select',
      filters: expect.objectContaining({ grid_owner_id: 'grid-owner-A' }),
    }))
    expect(resolverDbCalls()).toContainEqual(expect.objectContaining({
      table: 'customer_site_resolution',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        price_area: 'SE3',
        price_area_assurance_status: 'estimated',
        resolution_status: 'postal_suggested',
      }),
    }))
    expect(io.state.dbCalls).toContainEqual(expect.objectContaining({
      table: 'canonical_energy_flow_events',
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        event_type: 'energy_area.resolved',
      }),
    }))
    expect(websiteQuoteCalls()).toContainEqual(expect.objectContaining({
      operation: 'insert',
      payload: expect.objectContaining({
        company_id: 'company-A',
        api_client_id: 'client-A',
        annual_consumption_kwh: 3500,
      }),
    }))
  })
})
