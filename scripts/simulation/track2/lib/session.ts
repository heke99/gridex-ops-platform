import { createServerClient } from '@supabase/ssr'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { sim } from './env'
import { fixtureActorExpectation, observeFixtureActor } from './fixture'

/** Samma cookienamn som appen använder för vald företagskontext (lib/admin/navigationPreferences.ts). */
export const ADMIN_SELECTED_COMPANY_COOKIE = 'gridex_admin_selected_company_id'

export type ActorProof = {
  schema: 'gridex-t2-observed-actor-v1'; intent: 'authorized' | 'expected_denial'
  environmentId: string; assignmentSha256: string; sourceCommit: string
  userId: string; companyId: string; requestedCompanyId: string; observedAt: string
  authVerified: true; tenantRoleVerified: true; selectedCompanyVerified: boolean; requestedCompanyDenied?: true
  licenseVerified: false; licensePolicy: 'NO_APPLICATION_LICENSE_GATE_IDENTIFIED'
  ordinarySignup: 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION'; contextEvidenceSHA256: string
  contextEvidence: Record<string, unknown>; substitutions: string[]
}

const actorSourcePaths = ['scripts/simulation/track2/lib/fixture.ts', 'scripts/simulation/track2/lib/session.ts', 'scripts/simulation/track2/lib/term-fixture.ts']
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Binds evidence to the admitted private assignment and the actual app checkout; no label grants authority. */
function actorRuntimeBinding() {
  const assignmentFile = process.env.SIM_RUNTIME_ASSIGNMENT_FILE, home = process.env.SIM_HOME, runDir = process.env.RUN_DIR
  if (!assignmentFile || !home || !runDir || [assignmentFile, home, runDir].some(value => !path.isAbsolute(value) || fs.realpathSync(value) !== value)) {
    throw new Error('actor_runtime_paths_unqualified')
  }
  const fd = fs.openSync(assignmentFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let raw: Buffer
  try {
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error('actor_assignment_not_private')
    raw = fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
  if (raw.length > 65536) throw new Error('actor_assignment_too_large')
  const assignment = JSON.parse(raw.toString('utf8'))
  const actualCommit = execFileSync('git', ['-C', runDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (assignment.runDir !== runDir || assignment.simHome !== home || !/^[a-f0-9]{40}$/.test(assignment.sourceCommit)
    || assignment.sourceCommit !== actualCommit || typeof assignment.environmentId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/.test(assignment.environmentId)
    || assignment.syntheticActors?.policy !== 'source-bound-synthetic-only-observed-receipts-required'
    || assignment.syntheticActors?.ordinarySignup !== 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION'
    || assignment.syntheticActors?.observedReceiptState !== 'REQUIRED_AFTER_SCENARIO'
    || Object.keys(assignment.syntheticActors?.sourceFiles ?? {}).sort().join('\n') !== [...actorSourcePaths].sort().join('\n')) {
    throw new Error('actor_runtime_assignment_unqualified')
  }
  for (const sourcePath of actorSourcePaths) {
    const file = path.join(runDir, sourcePath), expected = assignment.syntheticActors.sourceFiles[sourcePath]
    if (fs.realpathSync(file) !== file || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
      || assignment.sourceFiles?.[sourcePath] !== expected || sha256(fs.readFileSync(file)) !== expected) {
      throw new Error('actor_runtime_source_mismatch')
    }
  }
  const homeInfo = fs.lstatSync(home)
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || homeInfo.uid !== process.getuid?.() || (homeInfo.mode & 0o777) !== 0o700) {
    throw new Error('actor_home_not_private')
  }
  return { home, sourceCommit: actualCommit, environmentId: assignment.environmentId as string, assignmentSha256: sha256(raw) }
}

function recordActorProof(home: string, proof: ActorProof): string {
  const dir = path.join(home, 'actor-receipts')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 })
  const info = fs.lstatSync(dir)
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(dir) !== dir
    || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) throw new Error('actor_receipt_directory_not_private')
  const receiptId = randomUUID()
  const fd = fs.openSync(path.join(dir, `${receiptId}.json`), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(proof) + '\n') } finally { fs.closeSync(fd) }
  return receiptId
}

export type AppSession = {
  userId: string
  /** Rå Cookie-header (innehåller sessionstokens; logga aldrig). */
  cookieHeader: string
  /** Safe projection only; never serialize the raw Supabase/Auth response. */
  actorProof?: ActorProof
  /** fetch mot appen med sessionen; följer inte redirects (status/Location blir synliga). */
  fetch: (pathAndQuery: string, init?: RequestInit) => Promise<Response>
}

/**
 * Riktig inloggning mot lokala GoTrue med @supabase/ssr (samma bibliotek och cookieformat
 * som appens proxy.ts/lib/supabase/server.ts), så att appen ser en vanlig sb-*-auth-token-session.
 * Auth/JWT-tid är real tid; ingen klockmanipulation.
 */
export async function loginSession(email: string, password: string, opts: { companyId?: string; intent?: 'expected_denial' } = {}): Promise<AppSession> {
  const jar = new Map<string, string>()
  const supabase = createServerClient(sim.apiUrl, sim.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { for (const c of cookies) { if (c.value) jar.set(c.name, c.value); else jar.delete(c.name) } },
    },
  })
  const hosted = process.env.SIM_REQUIRE_ACTOR_RECEIPT === '1'
  const { data, error } = await supabase.auth.signInWithPassword({ email, password }).catch(error => {
    if (hosted) throw new Error('actor_login_failed')
    throw error
  })
  if (error || !data.user) throw new Error(hosted ? 'actor_login_failed' : `inloggning misslyckades: ${error?.message ?? 'ingen användare'}`)
  if (jar.size === 0) throw new Error('inloggning gav inga sessionscookies')
  const cookieHeader = () => {
    const cookies = [...jar].map(([n, v]) => `${n}=${v}`)
    if (opts.companyId) cookies.push(`${ADMIN_SELECTED_COMPANY_COOKIE}=${opts.companyId}`)
    return cookies.join('; ')
  }
  async function observeActor(): Promise<{ home: string; proof: ActorProof }> {
    const binding = actorRuntimeBinding(), expected = fixtureActorExpectation(email)
    const requestedCompanyId = opts.companyId
    if (!uuid.test(expected.userId) || !uuid.test(expected.companyId) || !requestedCompanyId || !uuid.test(requestedCompanyId)
      || expected.permissionKeys.length === 0 || data.user!.id !== expected.userId) throw new Error('actor_fixture_identity_mismatch')
    const authenticated = await supabase.auth.getUser()
    if (authenticated.error || authenticated.data.user?.id !== expected.userId) throw new Error('actor_auth_identity_unverified')
    const observed = observeFixtureActor(expected.userId, expected.companyId)
    if (!observed.authActive || !observed.profileActive || !observed.companyActive || !observed.membershipActive
      || observed.roleKeys.length === 0 || !expected.permissionKeys.every(key => observed.rolePermissionKeys.includes(key))) {
      throw new Error('actor_scoped_fixture_state_unverified')
    }
    const ownResult = await supabase.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: expected.companyId })
    const own = ownResult.data
    if (ownResult.error || !own || own.authorized !== true || own.user_id !== expected.userId || own.selected_company_id !== expected.companyId
      || own.is_platform_admin !== false || !Array.isArray(own.roles) || !observed.roleKeys.every(key => own.roles.includes(key))
      || !Array.isArray(own.permissions) || own.permissions.length === 0 || !expected.permissionKeys.every(key => own.permissions.includes(key))
      || !Array.isArray(own.memberships) || !own.memberships.some((membership: { company_id?: string }) => membership.company_id === expected.companyId)
      || own.company?.id !== expected.companyId || own.company?.status !== 'active' || own.company?.lifecycle_status !== 'active') {
      throw new Error('actor_authenticated_tenant_context_unverified')
    }
    let requestedContext: Record<string, unknown> = { authorized: true, selectedCompanyId: expected.companyId }
    const denied = opts.intent === 'expected_denial'
    if (denied) {
      if (requestedCompanyId === expected.companyId || own.memberships.some((membership: { company_id?: string }) => membership.company_id === requestedCompanyId)) {
        throw new Error('actor_expected_denial_is_owned')
      }
      const foreign = await supabase.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: requestedCompanyId })
      if (foreign.error || !foreign.data || foreign.data.user_id !== expected.userId || foreign.data.selected_company_id === requestedCompanyId) {
        throw new Error('actor_expected_denial_not_observed')
      }
      requestedContext = { authorized: foreign.data.authorized === true,
        selectedCompanyId: typeof foreign.data.selected_company_id === 'string' && uuid.test(foreign.data.selected_company_id) ? foreign.data.selected_company_id : null }
    } else if (requestedCompanyId !== expected.companyId) throw new Error('actor_selected_company_mismatch')
    const contextEvidence = { fixture: observed, authenticatedUserId: expected.userId, ownSelectedCompanyId: own.selected_company_id,
      observedEffectiveRequiredPermissions: [...expected.permissionKeys].sort(), requestedContext }
    return { home: binding.home, proof: {
      schema: 'gridex-t2-observed-actor-v1', intent: denied ? 'expected_denial' : 'authorized',
      environmentId: binding.environmentId, assignmentSha256: binding.assignmentSha256, sourceCommit: binding.sourceCommit,
      userId: expected.userId, companyId: expected.companyId, requestedCompanyId, observedAt: new Date().toISOString(),
      authVerified: true, tenantRoleVerified: true, selectedCompanyVerified: !denied, ...(denied ? { requestedCompanyDenied: true as const } : {}),
      licenseVerified: false, licensePolicy: 'NO_APPLICATION_LICENSE_GATE_IDENTIFIED', ordinarySignup: 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION',
      contextEvidence, contextEvidenceSHA256: sha256(JSON.stringify(contextEvidence)),
      substitutions: ['GoTrue admin.createUser', 'SQL synthetic company/membership/role grants', 'No independent production license acceptance'],
    } }
  }
  async function qualifyActor() {
    try { return await observeActor() }
    catch { throw new Error('actor_qualification_failed') }
  }
  let actorProof = hosted ? (await qualifyActor()).proof : undefined
  const session: AppSession = {
    userId: data.user.id,
    get cookieHeader() { return cookieHeader() },
    get actorProof() { return actorProof },
    fetch: async (p, init = {}) => {
      const url = new URL(p, sim.appUrl)
      let receiptId: string | undefined
      if (hosted) {
        if (url.origin !== new URL(sim.appUrl).origin || url.username || url.password) throw new Error('actor_request_origin_unqualified')
        if (opts.intent === 'expected_denial' && (!['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) || !/^\/admin\/customers\/[^/]+$/.test(url.pathname))) {
          throw new Error('actor_expected_denial_read_only')
        }
        const current = await qualifyActor()
        actorProof = current.proof
        receiptId = recordActorProof(current.home, current.proof)
      }
      return fetch(url, { redirect: 'manual', ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader(), ...(receiptId ? { 'X-Sim-Actor-Receipt-Id': receiptId } : {}) } })
    },
  }
  if (hosted) Object.defineProperty(session, 'cookieHeader', { get: cookieHeader, enumerable: false })
  return session
}
