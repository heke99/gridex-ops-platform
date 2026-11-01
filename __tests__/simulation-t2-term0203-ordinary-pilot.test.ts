// Finite-port component qualification; no mailbox, Auth, DB or TERM acceptance.
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as oracle from '../scripts/simulation/track2/lib/term-oracle'

function load(filesystem: typeof fs | Record<string, unknown> = {}) {
  const filename = new URL('../scripts/simulation/track2/lib/pilot-term0203.ts', import.meta.url)
  const exports: Record<string, (...args: unknown[]) => unknown> = {}
  const forbidden = () => { throw Error('undeclared IO') }
  const billing: Record<string, unknown> = {}
  runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/simulation/track2/lib/term-billing.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: billing, require: (name: string) => {
    if (name === 'node:crypto') return crypto
    if (name === './term-oracle') return oracle
    if (name === './db') return { psql: forbidden, psqlRows: forbidden, serviceClient: forbidden }
    throw Error(`undeclared billing import ${name}`)
  }, Buffer, Date })
  const ports: Record<string, unknown> = {
    'node:crypto': crypto, 'node:fs': filesystem, 'node:path': path, 'nodemailer': {},
    './db': { psqlRows: forbidden }, './server-action': { callServerAction: forbidden },
    './term-fixture': {}, './term-billing': billing, './term-oracle': oracle, './env': { sim: {} },
  }
  runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText, { exports, require: (name: string) => {
    if (!(name in ports)) throw Error(`undeclared import ${name}`)
    return ports[name]
  }, Buffer, FormData, File, URL, Response, Date, console: { info: forbidden }, process: { env: {}, getuid: process.getuid } })
  return exports
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixtureControl(failure?: string) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {}, writes: string[] = []
  const company = uid(100), actor = uid(101), legal = uid(102), dso = uid(103)
  const authority = { declaration: 'TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE', specificationSha256: 'a'.repeat(64),
    authoritySourceSha256: 'b'.repeat(64), validFrom: '2020-01-01T00:00:00Z', validTo: '2099-01-01T00:00:00Z',
    regulatedIssuerCode: 'SYNTHETIC', regulatedReference: 'SYNTHETIC TEST AUTHORITY', regulatedKeyHex: 'cd'.repeat(32),
    networkRegistryVersion: 'SYNTHETIC-1', networkReference: 'SYNTHETIC REGISTRY', networkKeyHex: 'ef'.repeat(32) }
  const permissions = ['contracts.read', 'ediel.regulated_supply.review']
  let counter = 0, authCalls = 0
  const db = {
    psql: (sql: string) => { writes.push(sql); return '' },
    serviceClient: () => ({ auth: { admin: { createUser: async () => { authCalls++; return { data: { user: { id: actor } }, error: null } } } } }),
    psqlRows: (sql: string) => {
      if (sql.includes('FROM auth.users')) return [{ userId: actor, companyId: company, authActive: true, profileActive: true, companyActive: true, membershipActive: failure !== 'membership', roleKeys: ['scoped'], rolePermissionKeys: permissions }]
      if (sql.includes('SELECT id FROM public.companies')) return failure === 'missing-company' ? [] : [{ id: company }]
      if (sql.includes('AS legal')) return [{ legal, dso }]
      if (sql.includes('FROM public.tenant_bilateral_agreements')) return [{ agreement: uid(1), regulated_key: uid(2), regulated_representation: uid(3), network_key: uid(4), network_representation: uid(5),
        company_id: failure === 'catalog-tenant' ? uid(999) : company, environment: 'test', counterparty_actor_id: dso, issuer_code: authority.regulatedIssuerCode,
        legal_actor_id: legal, dso_actor_id: dso, permitted_kind: 'assigned_supply', bilateral_agreement_id: uid(1), network_actor_id: dso,
        registry_version: authority.networkRegistryVersion, legal_authority_source_hash: authority.authoritySourceSha256, legal_authority_hash: authority.authoritySourceSha256,
        regulated_key_hash: failure === 'key-hash' ? '0'.repeat(64) : crypto.createHash('sha256').update(Buffer.from(authority.regulatedKeyHex, 'hex')).digest('hex'),
        network_key_hash: crypto.createHash('sha256').update(Buffer.from(authority.networkKeyHex, 'hex')).digest('hex') }]
      throw Error('undeclared fixture read')
    },
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/simulation/track2/lib/fixture.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name: string) => {
      if (name === './db') return db
      if (name === './session') return { requirePlatformConfigurationRuntime() {} }
      if (name === 'node:crypto') return { ...crypto, randomUUID: () => uid(++counter) }
      throw Error(`undeclared fixture import ${name}`)
    }, Buffer, Date, process: { env: { SIM_REQUIRE_ACTOR_RECEIPT: '1' } },
  })
  return { exports, writes, authority, company, actor, permissions, authCalls: () => authCalls,
    bootstrap: () => exports.bootstrapPilotTestTrust({ companyId: company, actorUserId: actor, receiver: '54321', authority }) as Record<string, unknown> }
}

function platformControl(failure?: string) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {}, receipts: Array<{ file: string; value: string; mode?: number }> = []
  const requests: Array<{ url: string; init: RequestInit }> = [], dirs: Array<{ file: string; mode: number }> = []
  const sourceCommit = '6'.repeat(40), user = uid(70), company = uid(71), files = new Map<string, Buffer>(), sourceFiles: Record<string, string> = {}
  for (const leaf of ['fixture.ts', 'session.ts', 'term-fixture.ts']) {
    const relative = 'scripts/simulation/track2/lib/' + leaf, body = readFileSync(new URL('../' + relative, import.meta.url))
    files.set('/component/app/' + relative, body); sourceFiles[relative] = crypto.createHash('sha256').update(body).digest('hex')
  }
  files.set('/component/assignment.json', Buffer.from(JSON.stringify({ sourceCommit, environmentId: 'pilot-component', simHome: '/component/private', runDir: '/component/app',
    scenario: failure === 'scenario' ? 'scenarios/term02.test.ts' : 'scenarios/pilot-term0203.test.ts', pilotTerm0203: { materialSpecificationSha256: 'a'.repeat(64) },
    sourceFiles, syntheticActors: { policy: 'source-bound-synthetic-only-observed-receipts-required', ordinarySignup: 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION', observedReceiptState: 'REQUIRED_AFTER_SCENARIO', sourceFiles } })))
  if (failure === 'source-drift') files.set('/component/app/scripts/simulation/track2/lib/fixture.ts', Buffer.from('drift'))
  files.set('/component/app/.next/server/server-reference-manifest.json', Buffer.from(JSON.stringify({ node: {
    save: { filename: 'app/admin/inbound-mail/actions.ts', exportedName: 'saveSharedMailboxProfileAction', workers: { 'app/admin/inbound-mail/page': {} } },
    reprocess: { filename: 'app/admin/inbound-mail/actions.ts', exportedName: 'reprocessInboundEmailAction', workers: { 'app/admin/inbound-mail/page': {} } },
    delete: { filename: 'app/admin/inbound-mail/actions.ts', exportedName: 'deleteSharedMailboxProfileAction', workers: { 'app/admin/inbound-mail/page': {} } },
  } })))
  const fds = new Map<number, { file: string; mode?: number }>(); let nextFd = 10, authCalls = 0
  const info = (file: string) => ({ uid: 1000, mode: files.has(file) ? 0o100600 : 0o40700, isFile: () => files.has(file), isDirectory: () => !files.has(file), isSymbolicLink: () => false })
  const filesystem = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_WRONLY: 1, O_CREAT: 64, O_EXCL: 128 },
    existsSync: (file: string) => files.has(file) || file === '/component/private', realpathSync: (file: string) => file, lstatSync: info,
    openSync: (file: string, _flags: unknown, mode?: number) => { const fd = nextFd++; fds.set(fd, { file, mode }); return fd },
    fstatSync: (fd: number) => info(fds.get(fd)!.file), closeSync() {},
    readFileSync: (value: number | string) => { const file = typeof value === 'number' ? fds.get(value)!.file : value; if (!files.has(file)) throw Error('undeclared platform file'); return files.get(file) },
    mkdirSync: (file: string, opts: { mode: number }) => dirs.push({ file, mode: opts.mode }),
    writeFileSync: (fd: number, value: string) => receipts.push({ ...fds.get(fd)!, value }),
  }
  const fixture = {
    fixtureActorExpectation: () => ({ userId: user, companyId: company, permissionKeys: ['communication.write'], ...(failure === 'purpose' ? {} : { purpose: 'PLATFORM_CONFIGURATION' }) }),
    observeFixtureActor: () => ({ authActive: true, profileActive: true, companyActive: true, membershipActive: true, roleKeys: ['scoped'], rolePermissionKeys: ['communication.write'] }),
  }
  const ssr = { createServerClient: (_url: string, _key: string, opts: { cookies: { setAll(value: unknown): void } }) => ({
    auth: { signInWithPassword: async () => { opts.cookies.setAll([{ name: 'sb-auth', value: 'COOKIE_SENTINEL' }]); return { data: { user: { id: user } }, error: null } },
      getUser: async () => { authCalls++; return { data: { user: { id: failure === 'identity' || failure === 'fresh-auth' && authCalls > 1 ? uid(999) : user, access_token: 'JWT_SENTINEL' } }, error: null } } },
    rpc: async () => ({ error: null, data: { authorized: true, user_id: failure === 'context-user' ? uid(999) : user,
      is_platform_admin: failure !== 'context-role', selected_company_id: company, private_debug: 'SERVICE_KEY_SENTINEL',
      roles: ['scoped'], permissions: ['communication.write'], memberships: [{ company_id: company }], company: { id: company, status: 'active', lifecycle_status: 'active' } } }),
  }) }
  const modules: Record<string, unknown> = { 'node:crypto': crypto, 'node:fs': filesystem, 'node:path': path,
    'node:child_process': { execFileSync: () => sourceCommit }, '@supabase/ssr': ssr, './fixture': fixture,
    './env': { sim: { apiUrl: 'http://127.0.0.1:55001', anonKey: 'ANON_SENTINEL', appUrl: 'http://127.0.0.1:55008' } } }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/simulation/track2/lib/session.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    exports, require: (name: string) => { if (!(name in modules)) throw Error('undeclared platform import'); return modules[name] },
    process: { env: { SIM_REQUIRE_ACTOR_RECEIPT: '1', SIM_HOME: '/component/private', RUN_DIR: '/component/app', SIM_RUNTIME_ASSIGNMENT_FILE: '/component/assignment.json' }, getuid: () => 1000 },
    Buffer, Date, URL, Headers, fetch: async (url: string, init: RequestInit) => { requests.push({ url: String(url), init }); return new Response('controlled') },
  })
  type Session = { actorProof?: unknown; platformConfigurationProof?: unknown; fetch(route: string, init?: RequestInit): Promise<Response> }
  return { receipts, requests, dirs, authCalls: () => authCalls,
    login: () => exports.loginPlatformConfigurationSession('platform@example.invalid', 'PASSWORD_SENTINEL') as Promise<Session>,
    ordinary: () => exports.loginSession('platform@example.invalid', 'PASSWORD_SENTINEL', { companyId: company }) as Promise<Session> }
}

function termFactoryControl() {
  const exports: Record<string, (...args: unknown[]) => unknown> = {}
  const forbidden = () => { throw Error('undeclared factory IO') }
  const modules: Record<string, unknown> = { 'node:crypto': crypto, 'node:child_process': { execFileSync: forbidden },
    './db': { psql: forbidden, psqlRows: forbidden, serviceClient: forbidden }, './env': { sim: {} },
    './fixture': { createAdminFixture: forbidden, observeFixtureActor: forbidden }, './session': { loginSession: forbidden }, './server-action': { callServerAction: forbidden } }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/simulation/track2/lib/term-fixture.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name: string) => { if (!(name in modules)) return forbidden(); return modules[name] },
    process: { env: {}, getuid: process.getuid }, Buffer, Date, console: { info() {} },
  })
  return exports
}
function control(failure?: string) {
  const trace: string[] = [], requests: Array<{ route: string; body: unknown }> = []
  const company = uid(1), customer = uid(2), contractId = uid(3), point = uid(4), mailboxId = uid(5), artifactId = uid(6)
  const supplyMessage = uid(7), supplyPeriod = uid(8), e66Message = uid(9), underlay = uid(10), run = uid(11), invoice = uid(12)
  const proof = { intent: 'authorized', companyId: company, selectedCompanyVerified: true, assignmentSha256: 'a'.repeat(64), sourceCommit: 'b'.repeat(40), environmentId: 'test-pilot' }
  const actor = (userId: string) => ({ userId, actorProof: { ...proof }, fetch: () => { throw Error('undeclared fetch') } })
  const session = actor(uid(20)), reviewer = actor(failure === 'same-reviewer' ? uid(20) : uid(21)), platform = actor(uid(22))
  const start = Date.parse('2026-08-31T22:00:00Z'), end = Date.parse('2026-09-30T22:00:00Z')
  const intervals = Array.from({ length: (end - start) / 3_600_000 }, (_, i) => ({ start: new Date(start + i * 3_600_000).toISOString(), end: new Date(start + (i + 1) * 3_600_000).toISOString(), kwh: '0' }))
  const components = [{ component_code: 'monthly_fee', amount: 39, unit: 'sek_month' }, { component_code: 'spot_markup', amount: 4, unit: 'ore_per_kwh' }]
  const input = {
    contract: { companyId: company, customerId: customer, contractId, meteringPointId: point, gsrn: '735123456789000001',
      tenant: { runId: 'fixture', admin: { userId: uid(20) }, edielSender: '12345', edielReceiver: '54321' },
      sources: { contractRow: { monthly_fee_sek: 39, invoice_fee_sek: 19 }, snapshotRow: { price_components_snapshot: components, snapshot_json: { vat_rate: 0.25 } } } },
    session, reviewer, platform, billingMonth: '2026-09', bilateralAgreementId: uid(30), startAt: '2026-08-31T22:00:00Z',
    mailbox: { schema: 'gridex-t2-pilot-mailbox-service-v1', state: 'SERVICE_READY', ...proof, mailboxAddress: 'pilot@t2.sim.invalid',
      smtp: { host: '127.0.0.1', port: 10465, secure: true }, imap: { host: '127.0.0.1', port: 10993, secure: true, user: 'pilot' } },
    issuer: { issuerCode: 'SYNTHETIC', keyId: uid(31), representationId: uid(32), receiptSigningKeyHex: 'ab'.repeat(32),
      sourceReference: 'SYNTHETIC', sourceVersion: '1', legalDecisionReference: 'NOT LEGAL ACCEPTANCE' },
    groundPdf: Buffer.from('%PDF synthetic only'), groundDeclaration: 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE',
    z04: "BGM+Z04'LIN+{{GSRN}}'", e66: ["BGM+E66'LIN+{{GSRN}}'"], expectedIntervals: intervals,
  }
  // Descriptor and receipt use different names intentionally; source must check
  // the actual environment/source/assignment tuple, never just a nonempty label.
  Object.assign(input.mailbox, { assignmentSha256: proof.assignmentSha256, sourceCommit: proof.sourceCommit, environmentId: proof.environmentId })
  if (failure === 'tenant') reviewer.actorProof.companyId = uid(99)
  if (failure === 'binding') input.mailbox.assignmentSha256 = 'd'.repeat(64)
  if (failure === 'nonzero-input') input.expectedIntervals[0].kwh = '1'
  const lines = [
    { lineType: 'fixed_monthly_fee', description: 'Monthly', amountExVat: 39, vatAmount: 9.75, amountIncVat: 48.75, metadata: { component_code: 'monthly_fee' } },
    { lineType: 'fixed_fee', description: 'Invoice', amountExVat: 19, vatAmount: 4.75, amountIncVat: 23.75, metadata: { component_code: 'invoice_fee' } },
  ]
  const storedLines = lines.map((v, i) => ({ id: uid(70 + i), description: v.description, quantity: '1', unit: 'månad', unit_price_ex_vat: String(v.amountExVat), vat_rate: '0.25', sort_order: i * 10, line_type: v.lineType, amount_ex_vat: v.amountExVat, vat_amount: v.vatAmount, amount_inc_vat: v.amountIncVat, metadata: { ...v.metadata, private_key: 'ROW_SECRET_SENTINEL' } }))
  const originalRows: Record<string, unknown>[] = []
  const http = async (_session: unknown, route: string, body: unknown) => {
    trace.push(route); requests.push({ route, body })
    if (failure === 'transport' && route.endsWith('/scope')) throw Error('PASSWORD_SENTINEL')
    if (failure === 'http-refusal' && route.endsWith('/scope')) return { status: 409, body: { status: 'held' } }
    if (route.startsWith('/api/internal/inbound-mail/cron?')) return { status: 200, body: { ok: true, result: { mailboxesChecked: 1, failedJobs: 0, debug: { configurationError: null, errorsByMailbox: [], autoProcessErrors: [] } } } }
    if (route.endsWith('/scope')) return { status: 200, body: { status: 'scoped', scopeHash: 'c'.repeat(64), scope: { companyId: company, contractId, meteringPointId: point, customerIdentity: '199001010001', gridArea: 'TES' } } }
    if (route === '/api/ediel/regulated-supply-sources') return { status: 201, body: { status: 'archived', artifactId, companyId: company, sourceHash: crypto.createHash('sha256').update(input.groundPdf).digest('hex'), scopeHash: 'c'.repeat(64) } }
    if (route.endsWith('/review')) return { status: 200, body: { status: failure === 'review-held' ? 'held' : 'authorized', artifactId, groundId: uid(60), companyId: company, sourceHash: crypto.createHash('sha256').update(input.groundPdf).digest('hex'), scopeHash: 'c'.repeat(64) } }
    if (route.endsWith('/generate-underlay') || route.endsWith('/lock-preview')) return { status: 200, body: { data: {} } }
    if (route.endsWith('/pricing/preview')) return { status: 200, body: { data: { status: 'success', pricingRunId: failure === 'missing-run' ? null : run, errors: [], totalExVat: 58, vatAmount: 14.5, totalIncVat: 72.5, lines: failure === 'dropped-fee' ? lines.slice(0, 1) : lines } } }
    if (route.endsWith('/invoice-exports/create')) return { status: 200, body: { mode: 'prepare_only', approval_required: true, data: { created: 1, failed: 0, blocked: 0 } } }
    throw Error(`undeclared HTTP ${route}`)
  }
  const read = (sql: string) => {
    if (!sql.startsWith('SELECT ')) throw Error('business SQL write forbidden')
    if (sql.includes('public.ediel_mailboxes')) return [{ id: mailboxId, email_address: input.mailbox.mailboxAddress, imap_host: '127.0.0.1', imap_port: 10993, username: 'pilot', secret_reference: 'env:SIM_PILOT_MAILBOX_PASSWORD', metadata: { imap_secure: true } }]
    if (sql.includes('public.ediel_messages')) { const result = originalRows.at(-1)!; return [{ ...result, raw_payload: failure === 'original' ? 'wrong-original' : result.raw_payload }] }
    if (sql.includes('public.customer_supply_periods')) return [{ id: supplyPeriod, basis: { qualified: failure !== 'supply', sourceMessageId: supplyMessage, payloadHash: crypto.createHash('sha256').update(originalRows[0].raw_payload as string).digest('hex'), marketStateVersion: 1, marketStartAt: '2026-08-31T22:00:00.000Z', marketEndAt: null, groundId: uid(60), groundSourceSha256: crypto.createHash('sha256').update(input.groundPdf).digest('hex') } }]
    if (sql.includes('public.normalized_metering_values')) return intervals.map((v, i) => ({ id: uid(1000 + i), period_start: v.start, period_end: v.end, kwh: failure === 'nonzero-stored' && i === 0 ? '1' : '0', source_message_id: e66Message, supply_period_id: supplyPeriod, billing_status: 'billable', billing_gate_status: failure === 'metering-gate' ? 'blocked' : 'eligible' }))
    if (sql.includes('gridex_billing_source.underlay_bindings')) return [{ underlay_id: underlay, source_basis_hash: 'f'.repeat(64), actual_hash: failure === 'binding-hash' ? '0'.repeat(64) : 'f'.repeat(64), exact_total_kwh: '0', finalized_at: '2026-11-01T22:00:00.000Z', supply_period_id: supplyPeriod, supply_current: failure !== 'finalized-supply' }]
    if (sql.includes('gridex_billing_source.require_underlay_v1')) { if (failure === 'source-copy') throw Error('pilot_source_copy_unavailable'); return [{}] }
    if (sql.includes('public.billing_underlays')) return [{ id: underlay, status: 'validated', readiness_status: failure === 'underlay' ? 'blocked' : 'ready' }]
    if (sql.includes('public.invoice_provider_catalog')) return [{ provider: 'nordfin', selectable: failure !== 'provider-catalog' }]
    if (sql.includes('public.companies')) return [{ invoice_export_target_system: failure === 'provider' ? 'file_export' : 'nordfin', billing_provider_environment: 'test', invoice_export_enabled: false }]
    if (sql.includes('public.pricing_runs')) return [{ id: run, status: failure === 'unlocked' ? 'success' : 'locked', locked_at: '2026-11-01T22:01:00.000Z', total_ex_vat: 58, vat_amount: 14.5, total_inc_vat: 72.5 }]
    if (sql.includes('public.pricing_preview_lines')) return failure === 'stored-fee' ? storedLines.slice(0, 1) : storedLines
    if (sql.includes('public.invoice_export_items')) return [{ id: uid(50), provider: 'nordfin', environment: 'test', status: 'pending', attempt_count: 0, sent_at: null, export_file_id: null, provider_invoice_id: null, run_status: 'draft', approval_status: 'pending_review' }]
    if (sql.includes('public.invoice_export_attempts')) return [{ count: failure === 'transmission' ? 1 : 0 }]
    if (sql.includes('public.customer_invoices')) return [{ id: invoice, status: 'draft', invoice_export_item_id: uid(50), amount_ex_vat: failure === 'invoice-total' ? 39 : 58, vat_amount: 14.5, amount_inc_vat: 72.5, calculation_snapshot_sha256: 'e'.repeat(64), calculation_snapshot: { customer_contract_id: contractId, billing_underlay_id: underlay, pricing_run_id: run, pricing_lines: lines.map(v => ({ componentType: v.lineType, componentLabel: v.description, calculationUnit: 'månad', quantity: 1, valueAmount: v.amountExVat, amountSekExVat: v.amountExVat, vatAmount: v.vatAmount, amountIncVat: v.amountIncVat, metadata: v.metadata })) } }]
    throw Error(`undeclared SQL ${sql}`)
  }
  const action = async (_session: unknown, command: { exportedName: string }) => {
    trace.push(command.exportedName)
    if (!['saveSharedMailboxProfileAction', 'selectInvoiceProviderAction', 'reprocessInboundEmailAction'].includes(command.exportedName)) throw Error('undeclared action')
    return { httpStatus: 200, threw: false, errorRows: [], redirect: command.exportedName === 'selectInvoiceProviderAction' ? '/admin/billing/integrations?provider=selected' : null }
  }
  const deliver = async (mail: { raw: string }) => {
    trace.push('SMTP')
    const isSupply = mail.raw.includes('Z04')
    originalRows.push({ id: isSupply ? supplyMessage : e66Message, company_id: company, message_code: isSupply ? 'Z04' : 'E66', raw_payload: mail.raw, inbound_email_message_id: isSupply ? uid(40) : uid(41), mail_processing_status: 'processed' })
  }
  const runPilot = () => load().runPreparedTerm0203Pilot(input, { http, read, action, deliver }) as Promise<Record<string, unknown>>
  return { runPilot, input, trace, requests, storedLines, intervals }
}

async function scenarioControl(failure?: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't2-business-scenario-')); fs.chmodSync(home, 0o700)
  const app = path.join(home, 'app'), hosted = path.join(app, 'scripts/simulation/track2/hosted'); fs.mkdirSync(hosted, { recursive: true })
  const sourceCommit = 'b'.repeat(40), sourceTree = 'c'.repeat(40), c = control(), observed = await c.runPilot(), calls: string[] = []
  const helper = load(fs), profile = JSON.parse(readFileSync(new URL('../scripts/simulation/track2/hosted/profile.requirements.json', import.meta.url), 'utf8'))
  fs.writeFileSync(path.join(hosted, 'profile.requirements.json'), JSON.stringify(profile))
  const specification = { declaration: 'SYNTHETIC_NOT_EXTERNAL_LEGAL_ACCEPTANCE', billingMonth: '2026-09', signedDate: '2026-08-30', offerValidFrom: '2026-08-01', startsAt: '2026-09-01', startAt: '2026-08-31T22:00:00.000Z',
    signedPdfBase64: Buffer.from('%PDF signed synthetic').toString('base64'), groundPdfBase64: c.input.groundPdf.toString('base64'), authority: fixtureControl().authority,
    groundVersion: '1', groundDecisionReference: 'SYNTHETIC', network: { pdfBase64: Buffer.from('%PDF network synthetic').toString('base64'), reference: 'synthetic', version: '1', validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', clause: { locator: '1', quote: 'synthetic' } }, z04: c.input.z04, e66: c.input.e66 }
  const digest = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex')
  const assignment = { sourceCommit, sourceTree, environmentId: 'test-pilot', github: { runId: 123, runAttempt: 1 }, pilotTerm0203: { materialSpecificationSha256: digest(JSON.stringify(specification)), businessEvidenceRecipientCertificateSHA256: failure === 'certificate' ? '0'.repeat(64) : profile.bootstrapRecipientCertificateSHA256 } }
  const assignmentRaw = JSON.stringify(assignment), assignmentFile = path.join(home, 'assignment.json'), materialsFile = path.join(home, 'materials.json')
  fs.writeFileSync(assignmentFile, assignmentRaw, { mode: 0o600 })
  fs.writeFileSync(materialsFile, JSON.stringify({ schema: 'gridex-t2-term0203-materials-v1', assignmentSha256: digest(assignmentRaw), sourceCommit, environmentId: 'test-pilot', specification }), { mode: 0o600 })
  fs.mkdirSync(path.join(home, 'pilot-mailbox'), { mode: 0o700 }); fs.writeFileSync(path.join(home, 'pilot-mailbox/descriptor.json'), JSON.stringify(c.input.mailbox), { mode: 0o600 })
  let callback: (() => Promise<void>) | undefined
  const imports: Record<string, unknown> = {
    'node:crypto': crypto, 'node:fs': fs, 'node:path': path, 'vitest': { expect, it: (_name: string, fn: () => Promise<void>) => { callback = fn } },
    'node:child_process': { execFileSync: (program: string, args: string[]) => {
      if (program === 'git') return Buffer.from(args.at(-1) === 'HEAD^{tree}' ? failure === 'tree' ? '0'.repeat(40) : sourceTree : sourceCommit)
      if (args.includes('--job-context')) return Buffer.from(JSON.stringify({ jobId: failure === 'job' ? 0 : 456, job: 'term' }))
      if (args[0].endsWith('imap-mailbox.py')) return Buffer.from('{}')
      throw Error('undeclared scenario command')
    } },
    '../lib/fixture': { createAdminFixture: async () => ({ email: 'synthetic@example.invalid', password: 'PASSWORD_SENTINEL' }), bootstrapPilotTestTrust: () => ({ agreementId: uid(30), networkActorId: uid(31), networkKeyId: uid(32), networkRepresentationId: uid(33), regulatedKeyId: uid(34), regulatedRepresentationId: uid(35) }) },
    '../lib/term-fixture': { createTermTenant: async () => { calls.push('createTenant'); return { ...c.input.contract.tenant, companyId: c.input.contract.companyId } }, tenantSession: async () => c.input.session, createSignedContract: async () => c.input.contract },
    '../lib/session': { loginSession: async () => c.input.reviewer, loginPlatformConfigurationSession: async () => c.input.platform },
    '../lib/pilot-term0203': { ...helper, qualifyPilotNetworkSource: async () => ({ artifactId: uid(80), registryVersionId: uid(81), sourceHash: '1'.repeat(64), claimsHash: '2'.repeat(64), legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER' }), runPreparedTerm0203Pilot: async () => { if (failure === 'effects') throw Error('pilot_controlled_effect_refusal'); return observed } },
    '../lib/term-oracle': oracle,
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/simulation/track2/scenarios/pilot-term0203.test.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { exports: {}, require: (name: string) => { if (!(name in imports)) throw Error('undeclared scenario import'); return imports[name] }, Buffer, File,
      process: { getuid: process.getuid, env: { SIM_REQUIRE_ACTOR_RECEIPT: '1', SIM_RUNTIME_ASSIGNMENT_FILE: assignmentFile, SIM_TERM0203_MATERIALS_FILE: materialsFile, SIM_HOME: home, RUN_DIR: app, GITHUB_JOB: 'term', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sourceCommit } } })
  return { run: () => callback!(), calls, home, target: path.join(home, 'business-evidence/term0203-v1.private.json'), cleanup: () => fs.rmSync(home, { recursive: true, force: true }) }
}

describe('TERM02.03 ordinary pilot controls', () => {
  it.each([
    { signedDate: '2026-99-99' }, { signedDate: '2026-10-01' }, { offerValidFrom: '2026-09-01' },
    { file: new File([], 'empty.pdf', { type: 'application/pdf' }) }, { file: new File(['x'], 'wrong.txt', { type: 'text/plain' }) },
  ])('real contract factory rejects invalid uploaded input before any ordinary writes: %j', async change => {
    const factory = termFactoryControl()
    await expect(factory.createSignedContract({ offerCache: new Map() }, { startsAt: '2026-09-01', signedAt: '2026-08-30', contractType: 'variable_hourly' }, {
      uploadedAgreement: { signedDate: '2026-08-30', offerValidFrom: '2026-08-01', file: new File(['%PDF-1.7'], 'test.pdf', { type: 'application/pdf' }), ...change },
    })).rejects.toThrow('pilot_historical_signing_invalid')
  })
  it('creates only the explicitly requested hosted platform bootstrap account', async () => {
    const c = fixtureControl(), actor = await c.exports.createAdminFixture({ existingCompanyId: c.company, permissionKeys: c.permissions, purpose: 'PLATFORM_CONFIGURATION' }) as Record<string, unknown>
    expect(actor.purpose).toBe('PLATFORM_CONFIGURATION')
    expect(c.writes.join('\n')).toContain('INSERT INTO public.admin_users')
    expect(c.writes.join('\n')).not.toContain('INSERT INTO public.companies')
  })
  it('keeps platform setup receipts private and distinct from positive business actors', async () => {
    const c = platformControl(), session = await c.login()
    await session.fetch('/admin/inbound-mail', { method: 'POST', headers: { 'Next-Action': 'save', cookie: 'FORGED_COOKIE' } })
    await session.fetch(`/api/internal/inbound-mail/cron?environment=test&mailbox_id=${uid(5)}&force=1`, { method: 'POST' })
    expect(c.authCalls()).toBe(3)
    expect(session.actorProof).toBeUndefined()
    expect(c.receipts).toHaveLength(2)
    expect(c.dirs.every(v => v.mode === 0o700)).toBe(true)
    for (const receipt of c.receipts) {
      expect(receipt.file).toContain('/platform-actor-receipts/')
      expect(receipt.mode).toBe(0o600)
      const proof = JSON.parse(receipt.value)
      expect(proof).toMatchObject({ schema: 'gridex-t2-platform-configuration-actor-v1', intent: 'platform_configuration', selectedCompanyAuthorization: 'NOT_ASSERTED', platformAdminVerified: true })
      expect(proof.selectedCompanyVerified).toBeUndefined()
      expect(proof.tenantRoleVerified).toBeUndefined()
      for (const sentinel of ['COOKIE_SENTINEL', 'JWT_SENTINEL', 'SERVICE_KEY_SENTINEL', 'PASSWORD_SENTINEL']) expect(receipt.value + JSON.stringify(session)).not.toContain(sentinel)
    }
    expect(new Headers(c.requests[0].init.headers).get('cookie')).toBe('sb-auth=COOKIE_SENTINEL')
    expect(new Headers(c.requests[0].init.headers).has('X-Sim-Actor-Receipt-Id')).toBe(false)
  })
  it.each(['identity', 'context-user', 'context-role', 'purpose', 'scenario', 'source-drift'])('refuses unqualified platform %s before traffic', async failure => {
    const c = platformControl(failure)
    await expect(c.login()).rejects.toThrow('platform_configuration_qualification_failed')
    expect(c.requests).toEqual([]); expect(c.receipts).toEqual([])
  })
  it('rechecks actual platform Auth before every subsequent request', async () => {
    const c = platformControl('fresh-auth'), session = await c.login()
    await expect(session.fetch('/admin/inbound-mail', { method: 'POST', headers: { 'Next-Action': 'save' } })).rejects.toThrow('platform_configuration_qualification_failed')
    expect(c.requests).toEqual([]); expect(c.receipts).toEqual([])
  })
  it.each([
    ['/api/internal/pricing/preview', 'POST', 'save'], ['/admin/inbound-mail', 'GET', 'save'],
    ['/admin/inbound-mail', 'POST', 'delete'], ['https://foreign.invalid/admin/inbound-mail', 'POST', 'save'],
    [`/api/internal/inbound-mail/cron?environment=production&mailbox_id=${uid(5)}`, 'POST', ''],
    [`/api/internal/inbound-mail/cron?environment=test&mailbox_id=${uid(5)}&company_id=${uid(1)}`, 'POST', ''],
  ])('blocks platform misuse at %s', async (route, method, action) => {
    const c = platformControl(), session = await c.login()
    await expect(session.fetch(route, { method, headers: { 'Next-Action': action } })).rejects.toThrow(/platform_configuration_/)
    expect(c.requests).toEqual([]); expect(c.receipts).toEqual([])
  })
  it('keeps an actual platform administrator ineligible for ordinary tenant login', async () => {
    const c = platformControl()
    await expect(c.ordinary()).rejects.toThrow('actor_qualification_failed')
    expect(c.requests).toEqual([]); expect(c.receipts).toEqual([])
  })
  it('creates an independent scoped reviewer through actual fixture code without creating another company', async () => {
    const c = fixtureControl(), result = await c.exports.createAdminFixture({ existingCompanyId: c.company, permissionKeys: c.permissions }) as Record<string, unknown>
    expect(c.authCalls()).toBe(1)
    expect(result.companyId).toBe(c.company)
    expect(result.permissionKeys).toEqual(c.permissions)
    expect(c.writes.join('\n')).not.toContain('INSERT INTO public.companies')
    expect(c.writes.join('\n')).toContain('INSERT INTO public.role_permissions')
    expect(JSON.stringify(result)).not.toContain(String(result.password))
  })
  it('refuses an absent existing company before creating Auth identity', async () => {
    const c = fixtureControl('missing-company')
    await expect(c.exports.createAdminFixture({ existingCompanyId: c.company, permissionKeys: c.permissions })).rejects.toThrow('actor_existing_company_unverified')
    expect(c.authCalls()).toBe(0)
  })
  it('bootstraps only declared verifier/catalog configuration and exports hashes, never authority acceptance', () => {
    const c = fixtureControl(), receipt = c.bootstrap()
    expect(receipt.state).toBe('TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE')
    expect(receipt.observedRowsSha256).toMatch(/^[a-f0-9]{64}$/)
    const targets = [...c.writes.join('\n').matchAll(/INSERT INTO ([a-z_.]+)/g)].map(v => v[1]).sort()
    expect(targets).toEqual(['gridex_network_registry_sources.issuer_keys', 'gridex_network_registry_sources.representations', 'gridex_regulated_supply.issuer_keys', 'gridex_regulated_supply.issuer_representations', 'public.tenant_bilateral_agreements'])
    expect(JSON.stringify(receipt)).not.toContain(c.authority.networkKeyHex)
    expect(JSON.stringify(receipt)).not.toContain(c.authority.regulatedKeyHex)
  })
  it.each(['membership', 'catalog-tenant', 'key-hash'])('rejects an unverified bootstrap %s', failure => {
    const c = fixtureControl(failure)
    expect(() => c.bootstrap()).toThrow(/pilot_/)
    if (failure === 'membership') expect(c.writes).toEqual([])
  })
  it.each([false, true])('executes the real network original archive and independent review (held=%s)', async held => {
    const m = load(), requests: Array<{ actor: string; route: string; body: Record<string, unknown> }> = []
    const companyId = uid(1), pdf = Buffer.from('%PDF-1.7\nSYNTHETIC registry original\n%%EOF'), sourceHash = crypto.createHash('sha256').update(pdf).digest('hex')
    const session = { userId: uid(20), actorProof: { intent: 'authorized', companyId, selectedCompanyVerified: true } }
    const reviewer = { userId: uid(21), actorProof: { ...session.actorProof } }
    const operation = m.qualifyPilotNetworkSource({ companyId, session, reviewer, pdf,
      authority: { networkRegistryVersion: 'SYNTHETIC TEST', networkKeyHex: 'ab'.repeat(32) },
      catalog: { networkActorId: uid(30), networkKeyId: uid(31), networkRepresentationId: uid(32) },
      reference: 'SYNTHETIC ONLY', version: '1', validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-12-01T00:00:00Z',
      clause: { locator: 'page1', quote: 'SYNTHETIC registry original' },
    }, {
      read: () => [{ claims: { companyId, networkActorId: uid(30) } }],
      http: async (actor: { userId: string }, route: string, body: Record<string, unknown>) => {
        requests.push({ actor: actor.userId, route, body })
        return route.endsWith('/review') ? { status: held ? 409 : 200, body: { status: held ? 'held' : 'authorized', artifactId: uid(40), registryVersionId: uid(41) } }
          : { status: 201, body: { status: 'archived', artifactId: uid(40), sourceHash, claimsHash: 'c'.repeat(64) } }
      },
    }) as Promise<Record<string, unknown>>
    if (held) await expect(operation).rejects.toThrow('pilot_network_review_unconfirmed')
    else expect(await operation).toMatchObject({ registryVersionId: uid(41), legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER' })
    expect(requests.map(v => v.actor)).toEqual([session.userId, reviewer.userId])
    const issuer = requests[0].body.issuerReceipt as { payloadBase64: string; signatureHex: string }
    const payload = Buffer.from(issuer.payloadBase64, 'base64')
    expect(JSON.parse(payload.toString()).claims).toEqual({ companyId, networkActorId: uid(30) })
    expect(issuer.signatureHex).toBe(crypto.createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(payload).digest('hex'))
  })
  it('executes actual orchestration in order and preserves all invoice fees', async () => {
    const c = control(), result = await c.runPilot()
    expect(result.expectedInvoiceExVatOre).toBe('5800')
    expect(result.expectedInvoiceVatOre).toBe('1450')
    expect(result.expectedInvoiceIncVatOre).toBe('7250')
    expect(result.monthlyLineOre).toBe('3900')
    expect(result.legalAcceptance).toBe('NOT_PROVEN_SYNTHETIC_ISSUER')
    expect(c.trace.indexOf('/api/ediel/regulated-supply-sources/' + uid(6) + '/review')).toBeLessThan(c.trace.indexOf('SMTP'))
    expect(c.requests.find(v => v.route.endsWith('/pricing/preview'))?.body).toEqual({ billing_underlay_id: uid(10), persist: true })
    expect(JSON.stringify(result)).not.toContain(c.input.issuer.receiptSigningKeyHex)
  })
  it('returns explicit actual effect records and full normalized values with canonical hashes', async () => {
    const c = control(); c.storedLines[0].description = 'Observed stored monthly line'; c.storedLines[0].quantity = '1.000'
    const result = await c.runPilot(), effects = result.effects as Record<string, unknown>
    expect(effects).toBeDefined()
    const normalized = effects.normalizedValues as Array<Record<string, unknown>>
    expect(normalized).toHaveLength(c.intervals.length)
    expect(normalized[0]).toEqual({ id: uid(1000), periodStart: c.intervals[0].start, periodEnd: c.intervals[0].end, quantityKwh: '0', sourceMessageId: uid(9), supplyPeriodId: uid(8), billingStatus: 'billable', billingGateStatus: 'eligible' })
    expect(effects.normalizedValuesSha256).toBe(crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'))
    const pricing = effects.pricing as Record<string, unknown>, invoice = effects.invoice as Record<string, unknown>
    expect(pricing).toMatchObject({ id: uid(11), status: 'locked', totalExVatOre: '5800', vatOre: '1450', totalIncVatOre: '7250' })
    expect((pricing.lines as Array<Record<string, unknown>>)[0]).toMatchObject({ id: uid(70), description: 'Observed stored monthly line', quantity: '1.000', amountExVatOre: '3900', vatOre: '975' })
    expect(pricing.linesSha256).toBe(crypto.createHash('sha256').update(JSON.stringify(pricing.lines)).digest('hex'))
    expect(invoice).toMatchObject({ id: uid(12), calculationSnapshotSha256: 'e'.repeat(64), totalIncVatOre: '7250' })
    expect((invoice.lines as Array<Record<string, unknown>>)[0]).toMatchObject({ quantity: '1', unitPriceExVat: '39' })
    expect(invoice.linesSha256).toBe(crypto.createHash('sha256').update(JSON.stringify(invoice.lines)).digest('hex'))
    expect(effects.regulatedSource).toMatchObject({ artifactId: uid(6), groundId: uid(60), reviewStatus: 'authorized' })
    expect(effects.receivedOriginals).toEqual([
      { messageId: uid(7), inboundEmailMessageId: uid(40), messageCode: 'Z04', rawSha256: crypto.createHash('sha256').update(c.input.z04.replace('{{GSRN}}', c.input.contract.gsrn)).digest('hex') },
      { messageId: uid(9), inboundEmailMessageId: uid(41), messageCode: 'E66', rawSha256: crypto.createHash('sha256').update(c.input.e66[0].replace('{{GSRN}}', c.input.contract.gsrn)).digest('hex') },
    ])
    expect(effects.export).toMatchObject({ approvalStatus: 'pending_review', attemptCount: 0, companyAttemptCount: 0, sentAt: null })
    for (const secret of [c.input.issuer.receiptSigningKeyHex, c.input.groundPdf.toString(), 'raw_payload', 'calculation_snapshot', 'ROW_SECRET_SENTINEL']) expect(JSON.stringify(effects)).not.toContain(secret)
  })
  it('writes only the exact private versioned DTO once after successful observations', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 't2-business-evidence-')); fs.chmodSync(home, 0o700)
    try {
      const c = control(), result = await c.runPilot(), writer = load(fs)
      const binding = { sourceCommit: 'b'.repeat(40), sourceTree: 'c'.repeat(40), githubRunId: 123, githubRunAttempt: 1, githubJobId: 456, githubJob: 'term',
        assignmentSha256: 'a'.repeat(64), materialsSha256: 'd'.repeat(64), materialSpecificationSha256: 'e'.repeat(64), environmentId: 'test-pilot', billingMonth: '2026-09', recipientCertificateSha256: 'f'.repeat(64) }
      const network = { artifactId: uid(80), registryVersionId: uid(81), sourceHash: '1'.repeat(64), claimsHash: '2'.repeat(64), legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER' }
      writer.writeTerm0203BusinessEvidence(home, binding, network, result, { submittedByUserId: c.input.session.userId, reviewedByUserId: c.input.reviewer.userId })
      const target = path.join(home, 'business-evidence/term0203-v1.private.json'), raw = fs.readFileSync(target), dto = JSON.parse(raw.toString())
      expect(dto).toMatchObject({ schema: 'gridex-t2-term0203-business-evidence-v1', scenarioId: 'TERM02.03', wholeScenarioPass: false, wholeAcceptance: 'HOLD', legalAcceptance: 'NOT_PROVEN_SYNTHETIC_ISSUER', ...binding })
      expect(dto.effects).toEqual(result.effects); expect(dto.networkSource).toMatchObject({ artifactId: uid(80), sourceSha256: '1'.repeat(64), reviewStatus: 'authorized' })
      expect(fs.statSync(path.dirname(target)).mode & 0o777).toBe(0o700); expect(fs.statSync(target).mode & 0o777).toBe(0o600)
      expect(raw.length).toBeLessThanOrEqual(1_048_576); expect(raw.toString()).not.toContain(c.input.issuer.receiptSigningKeyHex)
      expect(() => writer.writeTerm0203BusinessEvidence(home, binding, network, result, { submittedByUserId: c.input.session.userId, reviewedByUserId: c.input.reviewer.userId })).toThrow()
      expect(fs.readFileSync(target)).toEqual(raw)
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
  it('registered scenario preserves network qualification and writes one complete private DTO', async () => {
    const c = await scenarioControl()
    try { await c.run(); const dto = JSON.parse(fs.readFileSync(c.target, 'utf8')); expect(dto.networkSource.registryVersionId).toBe(uid(81)); expect(dto.githubJobId).toBe(456); expect(dto.wholeScenarioPass).toBe(false); expect(dto.wholeAcceptance).toBe('HOLD'); expect(dto.effects.normalizedValues).toHaveLength(720) }
    finally { c.cleanup() }
  })
  it.each(['certificate', 'job', 'tree'])('registered scenario refuses %s binding before company/bootstrap side effects', async failure => {
    const c = await scenarioControl(failure)
    try { await expect(c.run()).rejects.toThrow(/pilot_business_/); expect(c.calls).toEqual([]); expect(fs.existsSync(c.target)).toBe(false) }
    finally { c.cleanup() }
  })
  it('registered scenario does not write a business file after effect refusal', async () => {
    const c = await scenarioControl('effects')
    try { await expect(c.run()).rejects.toThrow('pilot_controlled_effect_refusal'); expect(fs.existsSync(c.target)).toBe(false) }
    finally { c.cleanup() }
  })
  it.each(['home-mode', 'directory-symlink', 'directory-mode', 'file-symlink'])('refuses unsafe private evidence filesystem %s', async failure => {
    const c = await scenarioControl(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 't2-business-outside-'))
    try {
      const directory = path.dirname(c.target)
      if (failure === 'home-mode') fs.chmodSync(c.home, 0o755)
      if (failure === 'directory-symlink') fs.symlinkSync(outside, directory)
      if (failure === 'directory-mode') { fs.mkdirSync(directory, { mode: 0o700 }); fs.chmodSync(directory, 0o755) }
      if (failure === 'file-symlink') { fs.mkdirSync(directory, { mode: 0o700 }); fs.symlinkSync(path.join(outside, 'untouched'), c.target) }
      await expect(c.run()).rejects.toThrow(); expect(fs.readdirSync(outside)).toEqual([])
    } finally { c.cleanup(); fs.rmSync(outside, { recursive: true, force: true }) }
  })
  it('refuses interval/original evidence beyond declared limits before app traffic', async () => {
    for (const kind of ['intervals', 'originals']) {
      const c = control()
      if (kind === 'intervals') c.input.expectedIntervals = Array.from({ length: 1001 }, () => c.input.expectedIntervals[0])
      else c.input.e66 = Array.from({ length: 128 }, () => c.input.e66[0])
      await expect(c.runPilot()).rejects.toThrow('pilot_zero_full_month_required'); expect(c.trace).toEqual([])
    }
  })
  it.each(['same-reviewer', 'tenant', 'binding', 'nonzero-input', 'transport', 'http-refusal', 'review-held', 'original', 'supply', 'nonzero-stored', 'metering-gate', 'underlay', 'binding-hash', 'finalized-supply', 'source-copy', 'missing-run', 'dropped-fee', 'provider-catalog', 'provider', 'unlocked', 'stored-fee', 'invoice-total', 'transmission'])('fails closed at the real %s seam', async failure => {
    const c = control(failure)
    await expect(c.runPilot()).rejects.toThrow(/pilot_/)
    if (['same-reviewer', 'tenant', 'binding', 'nonzero-input'].includes(failure)) expect(c.trace).toEqual([])
    if (failure === 'transport') expect(c.trace.filter(v => v.endsWith('/scope'))).toHaveLength(1)
    if (['transport', 'http-refusal', 'review-held'].includes(failure)) expect(c.trace).not.toContain('SMTP')
  })
  it('accepts explicit historical signature, offer validity and period relation', () => {
    const m = load()
    expect(m.validatePilotHistoricalSigning({ signedDate: '2026-08-30', offerValidFrom: '2026-08-01', startsAt: '2026-09-01' })).toBeUndefined()
  })
  it.each([
    { signedDate: '2026-10-01', offerValidFrom: '2026-08-01', startsAt: '2026-09-01' },
    { signedDate: '2026-08-30', offerValidFrom: '2026-10-01', startsAt: '2026-09-01' },
    { signedDate: '2026-02-30', offerValidFrom: '2026-01-01', startsAt: '2026-09-01' },
  ])('rejects an incoherent pilot chronology before ordinary mutations', value => {
    expect(() => load().validatePilotHistoricalSigning(value)).toThrow('pilot_historical_signing')
  })
  it('constructs only an explicitly synthetic, scope-bound issuer receipt', () => {
    const m = load(), scope = { companyId: 'tenant', contractId: 'contract', meteringPointId: 'point', environment: 'test' }
    const issuer = { issuerCode: 'SYNTHETIC', keyId: 'key', representationId: 'representation', receiptSigningKeyHex: 'ab'.repeat(32),
      sourceReference: 'SYNTHETIC TEST ONLY', sourceVersion: '1', legalDecisionReference: 'SYNTHETIC NOT LEGAL ACCEPTANCE' }
    const receipt = m.signPilotGround({ scope, issuer, sourceHash: 'cd'.repeat(32) }) as { payloadBase64: string; signatureHex: string }
    const payload = JSON.parse(Buffer.from(receipt.payloadBase64, 'base64').toString())
    expect(payload.scope).toEqual(scope)
    expect(payload.sourceHash).toBe('cd'.repeat(32))
    expect(payload.legalDecisionReference).toBe(issuer.legalDecisionReference)
    expect(receipt.signatureHex).toBe(crypto.createHmac('sha256', Buffer.from(issuer.receiptSigningKeyHex, 'hex')).update(Buffer.from(receipt.payloadBase64, 'base64')).digest('hex'))
    expect(JSON.stringify(receipt)).not.toContain(issuer.receiptSigningKeyHex)
  })
})
