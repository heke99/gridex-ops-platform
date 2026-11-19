import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RouteRegistryPage from '@/app/admin/ediel/routes/page'

const actor = '10000000-0000-4000-8000-000000000001'
const differentActor = '10000000-0000-4000-8000-000000000002'
const testRoute = '10000000-0000-4000-8000-000000000003'
const productionRoute = '10000000-0000-4000-8000-000000000004'
const emailRoute = '10000000-0000-4000-8000-000000000005'

type RequirementRow = { actor_id: string; actor_name: string; actor_role: string; message_family: string }
const state = vi.hoisted(() => ({
  platformPage: true,
  platformAction: true,
  requirements: [] as RequirementRow[],
  queries: [] as { table: string; filter: URLSearchParams }[],
  unavailable: false,
  review: vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined),
  exclude: vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined),
  verify: vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: async () => {
    if (!state.platformPage) throw new Error('page denied')
  },
  requirePlatformAdminActionAccess: async () => {
    if (!state.platformAction) throw new Error('action denied')
  },
}))
vi.mock('@/app/admin/ediel/route-readiness/actions', () => ({
  createRouteManualReviewAction: state.review,
  markRouteNotRelevantAction: state.exclude,
  verifyActorRouteForManualSendAction: state.verify,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:32172', 'synthetic-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const url = new URL(request.url)
          expect(request.method).toBe('GET')
          expect(url.origin).toBe('http://127.0.0.1:32172')
          expect(url.pathname.startsWith('/rest/v1/')).toBe(true)
          const table = url.pathname.slice('/rest/v1/'.length)
          const filter = url.searchParams
          state.queries.push({ table, filter })
          switch (table) {
            case 'platform_actor_routes':
              return Response.json([
                { id: testRoute, environment: 'test', message_family: 'PRODAT' },
                { id: productionRoute, environment: 'production', message_family: 'PRODAT' },
                { id: emailRoute, environment: 'production', message_family: 'EMAIL' },
              ].map(row => ({
                ...row, actor_id: actor, status: 'active', platform_market_actors: { name: 'Syntetisk dubbelroll' },
              })))
            case 'platform_actor_roles':
              return Response.json(['electricity_supplier', 'supplier', 'grid_owner'].map(actor_role => ({
                actor_id: actor, actor_role, is_active: true,
              })))
            case 'platform_actor_import_issues':
              return Response.json([])
            case 'gridex_route_readiness_v': {
              if (state.unavailable) return Response.json({ code: 'PGRST205', message: 'test-internal-diagnostic' }, { status: 404 })
              const role = filter.get('actor_role')
              return Response.json(state.requirements.filter(row =>
                filter.get('actor_id') === 'eq.' + row.actor_id
                && filter.get('message_family') === 'eq.' + row.message_family
                && (!role || role === 'eq.' + row.actor_role),
              ))
            }
            default:
              throw new Error('Unexpected application query ' + table)
          }
        },
      },
    }),
  }
})

type Props = {
  children?: ReactNode
  href?: string
  action?: (form: FormData) => Promise<void>
  type?: string
  name?: string
  value?: string
}
type Element = ReactElement<Props>

function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements)
  if (!isValidElement<Props>(tree)) return []
  return [tree, ...elements(tree.props.children)]
}

function fields(form: Element): Record<string, string> {
  const result: Record<string, string> = {}
  for (const input of elements(form.props.children)) {
    const { type, name, value } = input.props
    if (input.type === 'input' && type === 'hidden' && name && value !== undefined) result[name] = value
  }
  return result
}

function submitFields(form: Element, decision: string) {
  const input = new FormData()
  for (const [key, value] of Object.entries(fields(form))) input.set(key, value)
  input.set('decision', decision)
  return input
}

function forms(tree: ReactNode) {
  return elements(tree).filter(element => element.type === 'form')
}

async function mount(params?: Record<string, string | string[]>) {
  return RouteRegistryPage({ searchParams: Promise.resolve(params ?? {}) })
}

function scopedUrl(link: Element) {
  return new URL(link.props.href!, 'http://127.0.0.1:32172')
}

async function mountRequirementLink(family: string) {
  const registry = await mount()
  const links = elements(registry).filter(element =>
    element.props.href && scopedUrl(element).searchParams.get('requirementFamily') === family,
  )
  expect(links.length).toBeGreaterThan(0)
  const url = scopedUrl(links[0])
  return mount(Object.fromEntries(url.searchParams.entries()))
}

beforeEach(() => {
  state.platformPage = true
  state.platformAction = true
  state.unavailable = false
  state.queries = []
  state.review.mockClear()
  state.exclude.mockClear()
  state.verify.mockClear()
  state.requirements = [
    { actor_id: actor, actor_name: 'Syntetisk dubbelroll', actor_role: 'grid_owner', message_family: 'PRODAT' },
    { actor_id: actor, actor_name: 'Syntetisk dubbelroll', actor_role: 'electricity_supplier', message_family: 'CONTACT' },
    { actor_id: actor, actor_name: 'Syntetisk dubbelroll', actor_role: 'supplier', message_family: 'CONTACT' },
    { actor_id: differentActor, actor_name: 'Annan aktör', actor_role: 'grid_owner', message_family: 'PRODAT' },
  ]
})

describe('registry route verification and explicit actor requirement decisions', () => {
  it('only offers exact route verification on each route and never chooses the first actor role', async () => {
    const tree = await mount()
    const registryForms = forms(tree)
    expect(registryForms).toHaveLength(3)
    expect(registryForms.every(form => form.props.action === state.verify)).toBe(true)
    expect(registryForms.map(fields)).toEqual([testRoute, productionRoute, emailRoute].map(routeId => ({ actorId: actor, routeId })))
    const prodLinks = elements(tree).filter(element =>
      element.props.href && scopedUrl(element).searchParams.get('requirementFamily') === 'PRODAT',
    )
    expect(prodLinks).toHaveLength(2)
    for (const item of prodLinks) {
      const url = scopedUrl(item)
      expect(url.pathname).toBe('/admin/ediel/routes')
      expect(url.hash).toBe('#beredskapskrav')
      expect(Object.fromEntries(url.searchParams.entries())).toEqual({ requirementActor: actor, requirementFamily: 'PRODAT' })
    }
    expect(state.queries.every(query => query.table !== 'gridex_route_readiness_v')).toBe(true)
  })

  it('opens the exact actor and family, advertises the wider scope and presents each canonical role separately', async () => {
    const prod = await mountRequirementLink('PRODAT')
    expect(forms(prod).map(fields).filter(row => row.actorRole)).toEqual([{ actorId: actor, actorRole: 'grid_owner', messageFamily: 'PRODAT' }])
    const contact = await mountRequirementLink('CONTACT')
    const html = renderToStaticMarkup(contact)
    expect(html.includes('id="beredskapskrav"')).toBe(true)
    expect(html.includes('Beslutet gäller rollen och meddelandefamiljen i både test och produktion')).toBe(true)
    expect(html.includes('Annan aktör')).toBe(false)
    expect(forms(contact).map(fields).filter(row => row.actorRole)).toEqual([
      { actorId: actor, actorRole: 'electricity_supplier', messageFamily: 'CONTACT' },
      { actorId: actor, actorRole: 'supplier', messageFamily: 'CONTACT' },
    ])
    const query = state.queries.filter(item => item.table === 'gridex_route_readiness_v').at(-1)!.filter
    expect(query.get('actor_id')).toBe('eq.' + actor)
    expect(query.get('message_family')).toBe('eq.CONTACT')
    expect(query.has('environment')).toBe(false)
    expect(state.review).not.toHaveBeenCalled()
    expect(state.exclude).not.toHaveBeenCalled()
    expect(state.verify).not.toHaveBeenCalled()
  })

  it.each(['review', 'exclude'] as const)('revalidates the explicit selected role before the %s command', async decision => {
    const page = await mountRequirementLink('CONTACT')
    const form = forms(page).find(item => fields(item).actorRole === 'supplier')!
    const action = form.props.action!
    const input = submitFields(form, decision)
    input.set('environment', 'test')
    input.set('routeId', testRoute)

    await action(input)

    expect(state[decision]).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries(state[decision].mock.calls[0][0].entries())).toEqual({
      actorId: actor, messageFamily: 'CONTACT', actorRole: 'supplier',
    })
    const query = state.queries.at(-1)!.filter
    expect(query.get('actor_id')).toBe('eq.' + actor)
    expect(query.get('message_family')).toBe('eq.CONTACT')
    expect(query.get('actor_role')).toBe('eq.supplier')
  })

  it('stops after a role changes or a separate platform action check denies', async () => {
    const page = await mountRequirementLink('PRODAT')
    const form = forms(page).find(item => fields(item).actorRole === 'grid_owner')!
    const action = form.props.action!
    const input = submitFields(form, 'review')
    state.requirements = []
    await expect(action(input)).rejects.toThrow('Beredskapskravet kunde inte verifieras')
    expect(state.review).not.toHaveBeenCalled()
    state.platformAction = false
    const previous = state.queries.length
    await expect(action(input)).rejects.toThrow('action denied')
    expect(state.queries).toHaveLength(previous)
  })

  it('rejects malformed form scope without querying or forwarding a decision', async () => {
    const page = await mountRequirementLink('PRODAT')
    const form = forms(page).find(item => fields(item).actorRole === 'grid_owner')!
    const input = submitFields(form, 'review')
    input.set('actorId', 'not-a-uuid')
    const previous = state.queries.length

    await expect(form.props.action!(input)).rejects.toThrow('Ogiltigt beredskapsbeslut')
    expect(state.queries).toHaveLength(previous)
    expect(state.review).not.toHaveBeenCalled()
  })

  it('does not read requirements for invalid query scope or any registry data when platform access is denied', async () => {
    const invalid = await mount({ requirementActor: actor, requirementFamily: ['PRODAT', 'UTILTS'] })
    expect(renderToStaticMarkup(invalid).includes('Välj en giltig aktör och meddelandefamilj')).toBe(true)
    expect(state.queries.every(query => query.table !== 'gridex_route_readiness_v')).toBe(true)
    state.queries = []
    state.platformPage = false
    await expect(mount({ requirementActor: actor, requirementFamily: 'PRODAT' })).rejects.toThrow('page denied')
    expect(state.queries).toEqual([])
  })

  it('represents unavailable requirements separately from an empty verified actor and family', async () => {
    state.requirements = []
    const params = { requirementActor: actor, requirementFamily: 'PRODAT' }
    const empty = await mount(params)
    expect(renderToStaticMarkup(empty).includes('Inga beredskapskrav hittades')).toBe(true)
    state.unavailable = true
    const failed = renderToStaticMarkup(await mount(params))
    expect(failed.includes('Beredskapskraven kunde inte läsas')).toBe(true)
    expect(failed.includes('test-internal-diagnostic')).toBe(false)
  })
})
