import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const baseUrl = 'https://synthetic.example.invalid'
const email = 'synthetic-admin@example.invalid'
const companyId = '11111111-1111-4111-8111-111111111111'
const require = createRequire(import.meta.url)
type Member = { email: string; companyId: string; userId: string; open?: boolean }
type Snapshot = { status: number | null; finalUrl: string; heading: string; secondaryHeadings: string[]; textNodes: string[]; marker: boolean; body: string; companyId: string; members: ReadonlyArray<Member> }
type Options = { name?: string | RegExp; level?: number; exact?: boolean }
const matches = (actual: string, expected?: string | RegExp) => expected === undefined || (typeof expected === 'string' ? actual === expected : expected.test(actual))

function snapshot(route: string): Snapshot {
  const pathname = new URL(route, baseUrl).pathname
  return {
    status: 200, finalUrl: new URL(route, baseUrl).href,
    heading: pathname === '/dashboard' ? 'Välkommen till Syntetiskt bolag' : pathname === '/admin/operations' ? 'Operations' : pathname === '/admin/customers' ? 'Kundregister' : 'Bolagsinställningar',
    secondaryHeadings: pathname === '/dashboard' ? ['Öppna bolagets arbetsyta'] : ['Bolagets användare och roller'],
    textNodes: pathname === '/dashboard' ? ['Inloggad', 'Inloggad'] : ['Öppna arbetsuppgifter'],
    marker: true, body: 'Syntetisk applikationssida', companyId,
    members: [{ email, companyId, userId: 'synthetic-user' }],
  }
}

async function renderedDashboard(platformAdmin: boolean): Promise<Snapshot> {
  // Render the actual page and layout, with only auth/data/navigation boundaries
  // replaced. This binds locator counts to current product JSX without a browser.
  function load(relative: string) {
    const exports: Record<string, unknown> = {}
    const file = path.resolve(import.meta.dirname, '..', relative)
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText
    runInNewContext(compiled, { exports, require: (name: string) => {
      if (name === 'next/link') return { __esModule: true, default: (props: { children: ReactNode; href: string }) => createElement('a', props, props.children) }
      if (name === 'next/navigation') return { redirect: () => { throw new Error('unexpected dashboard redirect') } }
      if (name === '@/lib/auth/currentUser') return { getVerifiedAuthUser: async () => ({ id: 'synthetic-user', email }) }
      if (name === '@/lib/auth/logoutAction') return { logoutAction: '/synthetic-logout' }
      if (name === '@/lib/supabase/server') return { createSupabaseServerClient: async () => ({ rpc: async () => ({ data: platformAdmin ? ['platform_admin'] : [], error: null }) }) }
      if (name === '@/lib/tenant/scope') return { getOperationalCompanyScope: async () => ({ companyName: 'Syntetiskt bolag' }) }
      if (name === '@/lib/rbac/roleKeys') return { isPlatformAdminRole: (role: string) => role === 'platform_admin' }
      if (name === 'react/jsx-runtime') return require(name)
      throw new Error(`unexpected dashboard dependency: ${name}`)
    } }, { filename: file, timeout: 1000 })
    return exports.default as (props?: { children: ReactNode }) => Promise<ReactNode>
  }
  const page = await load('app/dashboard/page.tsx')()
  const html = renderToStaticMarkup(await load('app/dashboard/layout.tsx')({ children: page }))
  const contents = (tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([^<>]*)</${tag}>`, 'g'))].map(match => match[1].trim())
  const headings = contents('h1')
  expect(headings).toHaveLength(1)
  return { ...snapshot('/dashboard'), heading: headings[0], secondaryHeadings: contents('h2'), textNodes: contents('p'), body: html }
}

// Finite DOM/navigation boundary, not a browser or app simulation. Locators
// assert actual fixture facts; no assertion is replaced with an unconditional pass.
class FixturePage {
  current = snapshot('/dashboard')
  visits: string[] = []
  listeners = new Map<string, (value: unknown) => void>()
  signals: string[] = []
  overrides = new Map<string, Partial<Snapshot>>()
  async goto(route: string) {
    const requested = new URL(route, baseUrl)
    this.visits.push(requested.pathname + requested.hash)
    const denied = requested.pathname.startsWith('/admin/companies') || requested.pathname.startsWith('/admin/platform/')
    const target = denied ? '/admin/company-settings' : requested.pathname + requested.hash
    this.current = { ...snapshot(target), ...this.overrides.get(requested.pathname) }
    if (requested.pathname === '/admin/operations') {
      for (const signal of this.signals) this.listeners.get(signal)?.(signal === 'console' ? { type: () => 'error' } : new Error('synthetic browser failure'))
    }
    return this.current.status === null ? null : { status: () => this.current.status }
  }
  url() { return this.current.finalUrl }
  on(name: string, callback: (value: unknown) => void) { this.listeners.set(name, callback) }
  async waitForURL(predicate: (url: URL) => boolean) { expect(predicate(new URL(this.url()))).toBe(true) }
  locator(selector: string) { return new FixtureLocator(this, selector) }
  getByRole(role: string, options: Options = {}) { return new FixtureLocator(this, `role:${role}`, options) }
  getByText(text: string, options: Options = {}) { return new FixtureLocator(this, 'text', { ...options, name: text }) }
  getByLabel(text: string) { return new FixtureLocator(this, `label:${text}`) }
}

class FixtureLocator {
  constructor(readonly page: FixturePage, readonly selector: string, readonly options: Options = {}, readonly member?: Member) {}
  first() { return this }
  nth(index: number) { return new FixtureLocator(this.page, 'member', {}, this.page.current.members[index]) }
  locator(selector: string) { return new FixtureLocator(this.page, selector, {}, this.member) }
  getByRole(role: string, options: Options = {}) { return new FixtureLocator(this.page, `role:${role}`, options, this.member) }
  getByLabel(text: string) { return new FixtureLocator(this.page, `label:${text}`, {}, this.member) }
  get visible(): boolean {
    const state = this.page.current
    if (this.selector === 'body' || this.selector === 'main, [role="main"], body') return true
    if (this.selector === 'role:heading') return this.options.level === 2
      ? state.marker && state.secondaryHeadings.some(text => matches(text, this.options.name))
      : matches(state.heading, this.options.name)
    if (this.selector === 'text') return matches(state.heading, this.options.name) || state.marker && state.textNodes.some(text => matches(text, this.options.name))
    if (this.selector === 'role:searchbox') return state.marker && matches('Sök kund', this.options.name)
    if (this.selector === 'role:table') return state.marker && matches('Kunder med anläggningar, senaste avtal och ärendestatus', this.options.name)
    if (this.selector === '#company-team') return state.marker
    if (this.selector === 'label:Systemroll') return Boolean(this.member?.open)
    return false
  }
  get attached() { return this.selector === 'member' ? Boolean(this.member) : this.selector.includes('company_id') ? Boolean(this.page.current.companyId) : this.visible }
  get text() { return this.selector === 'body' ? this.page.current.body : this.selector === 'role:heading' ? this.page.current.heading : '' }
  async waitFor({ state }: { state: string }) {
    expect(await this.count(), `strict fixture locator ${this.selector}`).toBe(1)
    expect(state === 'attached' ? this.attached : this.visible, `missing fixture node ${this.selector}`).toBe(true)
  }
  async innerText() { return this.text }
  async inputValue() {
    if (this.selector.includes('company_id')) return this.member?.companyId ?? this.page.current.companyId
    if (this.selector.includes('user_id')) return this.member?.userId ?? ''
    if (this.selector.includes('email')) return this.member?.email ?? ''
    return ''
  }
  async count() {
    const state = this.page.current
    if (this.selector === 'details[id^="company-user-"]') return state.members.length
    if (this.selector === 'text') return [state.heading, ...(state.marker ? state.textNodes : [])].filter(text => matches(text, this.options.name)).length
    if (this.selector === 'role:heading' && this.options.level === 2) return state.marker ? state.secondaryHeadings.filter(text => matches(text, this.options.name)).length : 0
    return this.attached ? 1 : 0
  }
  async evaluateAll(callback: (nodes: Array<{ value: string }>) => unknown) { return callback(this.page.current.members.map(member => ({ value: member.companyId }))) }
  async getAttribute(name: string) { return name === 'open' && this.member?.open ? '' : null }
  async click() {
    if (this.selector === 'role:button') { this.page.current = snapshot('/dashboard'); return }
    if (this.selector === 'summary' && this.member) { this.member.open = !this.member.open; return }
    throw new Error(`unexpected fixture click ${this.selector}`)
  }
  async fill() { /* Synthetic login input only; no transport. */ }
}

function playwrightExpect(value: unknown, message?: string) {
  if (value instanceof FixturePage) return { toHaveURL: async (pattern: RegExp) => expect(value.url(), message).toMatch(pattern) }
  if (value instanceof FixtureLocator) return {
    toBeVisible: async () => value.waitFor({ state: 'visible' }),
    toBeAttached: async () => expect(value.attached, message).toBe(true),
    toHaveCount: async (count: number) => expect(await value.count(), message).toBe(count),
    toContainText: async (text: string | RegExp) => typeof text === 'string' ? expect(value.text, message).toContain(text) : expect(value.text, message).toMatch(text),
    not: { toContainText: async (text: string) => expect(value.text, message).not.toContain(text) },
  }
  return expect(value, message)
}

function loadSpec(relative: string) {
  const callbacks: Array<(args: { page: FixturePage }, info: { attach: () => Promise<void> }) => Promise<void>> = []
  const artifacts: unknown[] = []
  const test = Object.assign((_name: string, callback: typeof callbacks[number]) => callbacks.push(callback), {
    skip(condition: boolean) { if (condition) throw new Error('Unexpected fixture skip') },
  })
  const env: Record<string, string> = {
    GRIDEX_E2E_BROWSER_BASE_URL: baseUrl, GRIDEX_E2E_BROWSER_EMAIL: email, GRIDEX_E2E_BROWSER_PASSWORD: 'synthetic-password-only',
    GRIDEX_E2E_PROD_BASE_URL: baseUrl, GRIDEX_E2E_TENANT_ADMIN_EMAIL: email, GRIDEX_E2E_TENANT_ADMIN_PASSWORD: 'synthetic-password-only',
  }
  function load(file: string): Record<string, unknown> {
    const exports = {}
    const context: Record<string, unknown> = { exports, module: { exports }, process: { env }, URL, Buffer, console }
    context.require = (name: string) => {
      if (name === '@playwright/test') return { test, expect: playwrightExpect }
      if (name === '@axe-core/playwright') return class { withTags() { return this } async analyze() { return { violations: [] } } }
      if (name === './helpers/evidence.mjs') return {
        requireEnv: (key: string) => env[key], productionRunId: () => 'synthetic-run',
        fingerprint: () => 'synthetic-fingerprint', safeUrlOrigin: (url: string) => new URL(url).origin,
        writeEvidence: (_file: string, artifact: unknown) => artifacts.push(artifact),
      }
      if (name.startsWith('node:')) return require(name)
      if (name.endsWith('/authenticated-page-contract.mjs')) return load(path.resolve(path.dirname(file), name)).exports
      throw new Error(`unexpected spec dependency: ${name}`)
    }
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    runInNewContext(compiled, context, { filename: file, timeout: 1000 })
    return context
  }
  const context = load(path.resolve(import.meta.dirname, '..', relative))
  return {
    artifacts,
    applicationPage: context.expectApplicationPage as (page: FixturePage, route: string) => Promise<void>,
    run: (page: FixturePage) => callbacks[0]({ page }, { attach: async () => {} }),
  }
}

describe('actual authenticated spec navigation boundary', () => {
  it.each([
    ['login redirect', { finalUrl: `${baseUrl}/login` }],
    ['403', { status: 403 }], ['404', { status: 404 }], ['500', { status: 500 }],
    ['wrong origin', { finalUrl: 'https://other.example.invalid/admin/operations' }],
    ['wrong path', { finalUrl: `${baseUrl}/admin` }],
    ['wrong heading', { heading: 'Glömt lösenord' }],
    ['heading without domain marker', { marker: false }],
    ['missing navigation response', { status: null }],
    ['framework error', { body: 'Application error' }],
  ] as const)('rejects %s instead of passing a visible body', async (_name, override) => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    page.overrides.set('/admin/operations', override)
    await expect(spec.applicationPage(page, '/admin/operations')).rejects.toThrow()
  })

  it.each(['/dashboard', '/admin/operations', '/admin/customers'])('accepts the intended %s destination with its own heading and marker', async route => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    await expect(spec.applicationPage(new FixturePage(), route)).resolves.toBeUndefined()
  })

  it('the fixture rejects an ambiguous exact text locator as Playwright does', async () => {
    const page = new FixturePage()
    page.current = await renderedDashboard(false)
    expect(await page.getByText('Inloggad', { exact: true }).count()).toBe(2)
    await expect(page.getByText('Inloggad', { exact: true }).waitFor({ state: 'visible' })).rejects.toThrow('strict fixture locator')
  })

  it.each([false, true])('accepts the actual dashboard page/layout markup for platformAdmin=%s despite repeated chrome text', async platformAdmin => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    const rendered = await renderedDashboard(platformAdmin)
    page.overrides.set('/dashboard', rendered)
    await expect(spec.applicationPage(page, '/dashboard')).resolves.toBeUndefined()
  })

  it('rejects the correct dashboard heading and repeated chrome text without its domain card heading', async () => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    page.overrides.set('/dashboard', { ...await renderedDashboard(false), secondaryHeadings: [] })
    await expect(spec.applicationPage(page, '/dashboard')).rejects.toThrow()
  })

  it('rejects the customer no-company fallback even though its heading is still Kundregister', async () => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    page.overrides.set('/admin/customers', { marker: false, body: 'Kontot saknar aktiv bolagskoppling' })
    await expect(spec.applicationPage(page, '/admin/customers')).rejects.toThrow()
  })

  it('the actual staging test consumes the shared oracle rather than a separate weak navigation path', async () => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    page.overrides.set('/admin/operations', { finalUrl: `${baseUrl}/login` })
    await expect(spec.run(page)).rejects.toThrow()
  })

  it.each(['console', 'requestfailed'])('the staging spec rejects %s failures during otherwise valid navigation', async signal => {
    const spec = loadSpec('e2e/browser/authenticated.spec.mjs')
    const page = new FixturePage()
    page.signals = [signal]
    await expect(spec.run(page)).rejects.toThrow()
  })
})

describe('actual tenant-admin spec scope', () => {
  it('accepts the own company settings team and retains all platform denials without submitting any form', async () => {
    const spec = loadSpec('e2e/production/tenant-admin-verify.spec.mjs')
    const page = new FixturePage()
    await expect(spec.run(page)).resolves.toBeUndefined()
    expect(page.visits).toContain('/admin/company-settings#company-team')
    expect(page.visits).toContain(`/admin/companies/${companyId}/users`)
    expect(page.visits).toContain('/admin/companies')
    expect(page.visits).toContain('/admin/platform/go-live')
    expect(spec.artifacts).toEqual([expect.objectContaining({ status: 'passed', mutation_attempted: false, tenant: { company_id: companyId } })])
  })

  it.each([`/admin/companies/${companyId}/users`, '/admin/companies', '/admin/platform/go-live'])('rejects an unexpectedly allowed platform destination %s', async route => {
    const spec = loadSpec('e2e/production/tenant-admin-verify.spec.mjs')
    const page = new FixturePage()
    page.overrides.set(route, { finalUrl: `${baseUrl}${route}` })
    await expect(spec.run(page)).rejects.toThrow()
    expect(spec.artifacts).toEqual([expect.objectContaining({ status: 'failed' })])
  })

  it.each([
    ['missing scope', { companyId: '' }],
    ['foreign team ownership', { members: [{ email, companyId: '22222222-2222-4222-8222-222222222222', userId: 'other' }] }],
    ['identity only in page chrome', { members: [{ email: 'someone-else@example.invalid', companyId, userId: 'other' }] }],
    ['empty team', { members: [] }],
    ['missing team marker', { marker: false }],
    ['login redirect', { finalUrl: `${baseUrl}/login` }],
  ] as const)('rejects %s and emits only failed evidence', async (_name, override) => {
    const spec = loadSpec('e2e/production/tenant-admin-verify.spec.mjs')
    const page = new FixturePage()
    page.overrides.set('/admin/company-settings', override)
    await expect(spec.run(page)).rejects.toThrow()
    expect(spec.artifacts).toEqual([expect.objectContaining({ status: 'failed', mutation_attempted: false })])
    expect(JSON.stringify(spec.artifacts)).not.toContain(email)
    expect(JSON.stringify(spec.artifacts)).not.toContain('synthetic-password-only')
  })
})
