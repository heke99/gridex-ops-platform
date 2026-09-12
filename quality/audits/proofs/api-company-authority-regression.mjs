import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

function load(path, names, dependencies) {
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const exposed = names
    .map((name) => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`)
    .join(',')
  const context = vm.createContext({ console, Date, Error, ...dependencies })
  vm.runInContext(`${source}\nglobalThis.loaded = {${exposed}}`, context, { filename: path })
  return context.loaded
}

const state = {
  selected: 'A',
  resets: [],
  mutations: [],
  reads: [],
}

const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, body }
  },
}

const lifecycle = load('lib/tenant/lifecycle.ts', [
  'isCompanyVisibleInTenantWorkspace',
  'isCompanyWritableInTenantWorkspace',
], {})
const roles = load('lib/rbac/roleKeys.ts', [
  'normalizeRoleKey',
  'resolveRoleKey',
  'isPlatformAdminRole',
], {})
const accessModel = load('lib/admin/accessModel.ts', ['hasPermissionRequirement'], {})

function query(table) {
  const call = { table, operation: 'select', filters: {}, payload: null }
  const result = () => {
    if (call.operation !== 'select') {
      state.mutations.push(structuredClone(call))
      return call.table === 'ediel_manual_review_items'
        ? { data: { id: 'review-1' }, error: null }
        : { data: call.payload, error: null }
    }
    state.reads.push(structuredClone(call))
    if (table === 'company_memberships') {
      return {
        data: ['A', 'B'].map((companyId) => ({
          company_id: companyId,
          membership_role: 'admin',
          status: 'active',
          companies: { id: companyId, name: companyId, slug: companyId.toLowerCase(), org_number: null, status: 'active' },
        })),
        error: null,
      }
    }
    if (table === 'ediel_messages') {
      const requestedId = String(call.filters.id ?? '')
      const requestedCompanyId = requestedId.endsWith('-A') ? 'A' : 'B'
      const row = {
        id: requestedId, company_id: requestedCompanyId, direction: 'inbound', message_standard: 'edifact',
        message_family: 'OTHER', message_code: 'UNKNOWN', raw_payload: '', parsed_payload: {},
      }
      return call.filters.company_id && call.filters.company_id !== row.company_id
        ? { data: null, error: { code: 'PGRST116', message: 'not found' } }
        : { data: row, error: null }
    }
    if (table === 'metering_points') return { data: [], error: null }
    return { data: null, error: null }
  }
  const builder = {
    select() { return builder },
    eq(column, value) { call.filters[column] = value; return builder },
    in() { return builder },
    order() { return builder },
    limit() { return builder },
    or() { return builder },
    upsert(payload) { call.operation = 'upsert'; call.payload = payload; return builder },
    async single() { return result() },
    async maybeSingle() { return result() },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }
  return builder
}

const supabaseService = {
  from: query,
  async rpc() { return { data: [], error: null } },
}
const tenantScope = load('lib/tenant/scope.ts', [
  'assertUserCanOperateCompany',
  'requireOperationalCompanyId',
], {
  ...lifecycle,
  ...roles,
  cache: (fn) => fn,
  cookies: async () => ({ get: () => ({ value: state.selected }) }),
  ADMIN_SELECTED_COMPANY_COOKIE: 'company',
  supabaseService,
})

const apiGuards = load('lib/admin/apiGuards.ts', [
  'requireAdminApiAccess',
  'assertAdminApiCompanyAccess',
], {
  ...accessModel,
  ...roles,
  ...tenantScope,
  NextResponse,
  cookies: async () => ({ get: () => ({ value: state.selected }) }),
  ADMIN_SELECTED_COMPANY_COOKIE: 'company',
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    rpc: async () => ({
      data: {
        authorized: true,
        user_id: 'actor',
        selected_company_id: state.selected,
        is_platform_admin: false,
        roles: ['custom_role'],
        permissions: ['billing.write', 'billing.export', 'ediel.write'],
      },
      error: null,
    }),
  }),
})

const retryRoute = load('app/api/internal/invoice-exports/[id]/retry/route.ts', ['POST'], {
  ...apiGuards,
  ...tenantScope,
  NextResponse,
  internalApiError: () => NextResponse.json({ error: 'failed' }, { status: 500 }),
  resetFailedInvoiceExportItems: async (input) => { state.resets.push(input) },
})

const canonicalPayload = {
  messageFamilyForStorage: 'OTHER', messageCode: null, sender: null, receiver: null,
  receiverSubAddress: null, facilityId: null, meteringPointId: null, gridArea: null,
  applicationReference: null, transactionReference: null, businessReference: null,
}
const inbound = load('lib/ediel/inboundRequestAutomation.ts', ['evaluateInboundEdielRequest'], {
  supabaseService,
  parseCanonicalEdielPayload: () => canonicalPayload,
  canonicalUtiltsProfileForMessage: () => null,
})
const edielRoute = load('app/api/internal/ediel/inbound-request-automation/route.ts', ['POST'], {
  ...apiGuards,
  ...inbound,
  NextResponse,
  internalApiError: () => NextResponse.json({ error: 'failed' }, { status: 500 }),
})

const retryResponse = await retryRoute.POST(
  { json: async () => ({ companyId: 'B' }) },
  { params: Promise.resolve({ id: 'export-1' }) },
)
assert.equal(retryResponse.status, 500)
assert.equal(state.resets.length, 0, 'A permission context must not reset a B export')
assert.equal(state.reads.length, 0, 'mismatched submitted company must fail before service reads')

const edielResponse = await edielRoute.POST({
  json: async () => ({ message_id: 'message-B', forceManualReview: true }),
})
assert.equal(edielResponse.status, 500)
const messageRead = state.reads.find((call) => call.table === 'ediel_messages')
assert.deepEqual(messageRead?.filters, { id: 'message-B', company_id: 'A' })
assert.equal(state.mutations.length, 0, 'foreign message must not create decisions or manual review')

state.reads = []
state.mutations = []
await assert.rejects(
  inbound.evaluateInboundEdielRequest({ messageId: 'message-A', companyId: '   ' }),
  /Ediel-meddelandet hittades inte/,
)
assert.equal(state.reads.length, 0, 'explicit blank scope must fail before lookup')

await inbound.evaluateInboundEdielRequest({ messageId: 'message-A', forceManualReview: true })
assert.deepEqual(
  state.reads.find((call) => call.table === 'ediel_messages')?.filters,
  { id: 'message-A' },
)

state.reads = []
state.mutations = []
await inbound.evaluateInboundEdielRequest({ messageId: 'message-A', companyId: ' A ', forceManualReview: true })
assert.deepEqual(
  state.reads.find((call) => call.table === 'ediel_messages')?.filters,
  { id: 'message-A', company_id: 'A' },
)

console.log('PASS actual retry route and Ediel route/helper deny A/B effects; blank/omitted/scoped helper contracts hold')
