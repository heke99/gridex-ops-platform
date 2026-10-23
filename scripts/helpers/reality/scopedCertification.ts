// World stand-in for the Ediel test phase's scoped production evidence (FINDINGS F90).
//
// The transport refuses every production business message until
// ediel_scoped_capability_readiness_v1 finds an immutable proof for the message's exact
// scope (tenant/legal actor/role/family/code/subtype/assignment) and dependency hash
// (release SHA + receipt, route, rule pack, capability rows ...). The platform has no
// product path that leaves that proof behind (recordScopedEdielProductionEvidence has no
// caller; no migration seeds evidence). This stand-in does what a real test-phase
// publication would have to leave behind, through the platform's own writers only:
//   1. the verified production release receipt of the running build
//      (canonical_record_platform_release_receipt; CI run / deployment marked simulated);
//   2. the tenant's enabled outbound message capability for each pending scope
//      (tenant_message_capabilities has no product writer at all; marked simulated);
//   3. the test-phase result on the tenant's simulated certification rows
//      (metadata.edielScopedReadiness: scope, dependency hash, tests on this release SHA);
//   4. the proof itself, through recordScopedEdielProductionEvidence.
// Only tenants whose production certification evidence is marked
// metadata.reality_simulated=true (simulateEdielCertifiedGoLive, F36) are touched.
//
// F90: the record RPC requires EVERY certification row to name the one scope and
// dependency hash it certifies, and readiness requires the live rows to equal the copy in
// the proof. Certification rows are unique per (company, environment, type, engine
// version), so a tenant has ONE certifiable (scope, route, release) at a time. This
// stand-in therefore never rebinds rows while any pending scope is ready; when no pending
// scope is ready it certifies one: the scope the rows were last bound to if it is still
// pending (a redeploy or route change), else the first preferred scope (default PRODAT/Z03,
// the supplier switch the scenarios are driven by), else the oldest pending message's
// scope. Rebinding voids the previous scope's proof (reported). Every other pending scope
// is reported as unsendable. Product SQL is not changed and the gate is not weakened.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { supabaseService } from '@/lib/supabase/service'
import { getScopedEdielProductionReadiness, recordScopedEdielProductionEvidence, type ScopedEdielReadiness } from '@/lib/ediel/scopedCapabilityReadiness'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { literal, sql } from '../live-chain-fixture'

const PROOF_DAYS = 30
const DEFAULT_PREFER = ['PRODAT/Z03']
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(value)
const scopeLabel = (s: ScopedEdielReadiness['scope']) => `${s.family}/${s.code}${s.subtype ? `/${s.subtype}` : ''}${s.assignmentId ? `@${s.assignmentId}` : ''}`
function failure(error: unknown) {
  const e = error as Error & { cause?: { message?: string } }
  return e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message
}

function releaseSha(): string {
  const git = process.env.GIT_COMMIT_SHA, vercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (!git || !/^[0-9a-f]{40}$/.test(git)) throw Error('reality_git_commit_sha_required')
  // The transport reads VERCEL_GIT_COMMIT_SHA first: both must name the same build.
  if (vercel && vercel !== git) throw Error('reality_release_sha_ambiguous')
  return git
}

/** The running build's verified production release receipt, recorded once per SHA. */
async function ensureReleaseReceipt(sha: string) {
  const current = sql<string | null>(`SELECT to_jsonb(release_sha) FROM public.platform_release_receipts WHERE environment='production' AND status='verified'
    AND verified_at IS NOT NULL AND nullif(ci_run_id,'') IS NOT NULL AND nullif(deployment_id,'') IS NOT NULL ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1`)
  if (current === sha) return { releaseSha: sha, recorded: false }
  const runtime = sql<{ migration: string; fingerprint: string }>(`SELECT jsonb_build_object('migration',migration_version,'fingerprint',schema_fingerprint) FROM public.platform_runtime_readiness WHERE id`)
  const root = process.cwd()
  const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  const openapi = readdirSync(resolve(root, 'docs/openapi')).filter(f => f.endsWith('.json')).sort()
    .map(f => readFileSync(resolve(root, 'docs/openapi', f))).reduce((h, b) => h.update(b), createHash('sha256')).digest('hex')
  const marker = { reality_simulated: true, finding: 'F90', note: 'stand-in for the CI/deploy pipeline that records the production release receipt' }
  const { data, error } = await supabaseService.rpc('canonical_record_platform_release_receipt', {
    p_release_sha: sha, p_ci_run_id: `reality-simulated-ci:${sha}`, p_deployment_id: `reality-simulated-deployment:${sha}`, p_environment: 'production',
    p_schema_migration_version: runtime.migration, p_migration_manifest_hash: sha256(migrations.join('\n')), p_database_schema_fingerprint: runtime.fingerprint,
    p_generated_types_hash: sha256(readFileSync(resolve(root, 'supabase/database.types.ts'))), p_openapi_contract_version: 'reality-simulated', p_openapi_hash: openapi,
    p_reconciliation_result: marker, p_performance_evidence: marker, p_evidence: marker,
  } as never)
  if (error) throw Error(`reality_release_receipt_failed: ${error.message}`)
  return { releaseSha: sha, recorded: true, receiptId: data as unknown as string }
}

type Pending = { message: EdielMessageRow; readiness?: ScopedEdielReadiness; refused?: string }
type CertRow = { id: string; type: string; bound: { scope?: unknown; dependencyHash?: string } | null; validUntil: string | null }

async function certifyTenant(companyId: string, sha: string, prefer: string[]) {
  // Pending production business messages: what the outbox will still try to send. A message whose outbox entry
  // already failed, was blocked or went out is never tried again (FINDINGS O1/B1); counting it would keep the
  // F90 rows bound to a scope that can never be sent and starve every other scope (FINDINGS T10).
  const pendingFilter = `m.company_id=${literal(companyId)} AND m.environment='production' AND m.direction='outbound' AND m.status IN ('queued','draft')
    AND m.message_family IN ('PRODAT','UTILTS','AI_LIST') AND NOT (m.message_family='UTILTS' AND m.message_code='ERR')
    AND NOT EXISTS(SELECT FROM public.ediel_outbox o WHERE o.ediel_message_id=m.id AND o.status IN ('failed','sent','delivery_uncertain','blocked','blocked_tenant_state'))`
  // The tenant's own enabled outbound capability per pending scope (derived by the gate's own source_scope).
  const capabilities = sql<unknown[]>(`CREATE FUNCTION pg_temp.scope(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql AS $$
     BEGIN RETURN gridex_ediel_readiness.source_scope(m); EXCEPTION WHEN raise_exception THEN RETURN NULL; END $$;
    WITH scopes AS (SELECT DISTINCT s->>'family' family,s->>'code' code,coalesce(s->>'subtype','*') subtype FROM public.ediel_messages m CROSS JOIN LATERAL pg_temp.scope(m) s
      WHERE ${pendingFilter} AND s IS NOT NULL),
    added AS (INSERT INTO public.tenant_message_capabilities(company_id,environment,message_family,message_code,transaction_subtype,direction,is_enabled,valid_from,metadata)
      SELECT ${literal(companyId)},'production',family,code,subtype,'outbound',true,clock_timestamp()-interval '1 minute',
       '{"reality_simulated":true,"finding":"F90","note":"tenant_message_capabilities has no product writer"}'::jsonb FROM scopes s
      WHERE NOT EXISTS(SELECT FROM public.tenant_message_capabilities c WHERE c.company_id=${literal(companyId)} AND c.environment='production' AND c.message_family=s.family
       AND c.message_code=s.code AND c.transaction_subtype IN ('*',CASE s.subtype WHEN '*' THEN '' ELSE s.subtype END) AND c.direction IN ('outbound','both') AND c.is_enabled
       AND c.valid_from<=now() AND (c.valid_to IS NULL OR c.valid_to>now()))
      RETURNING message_family||'/'||message_code||'/'||transaction_subtype k)
    SELECT coalesce(jsonb_agg(k ORDER BY k),'[]') FROM added`)

  const ids = sql<string[]>(`SELECT coalesce(jsonb_agg(m.id ORDER BY m.created_at,m.id),'[]') FROM public.ediel_messages m WHERE ${pendingFilter}`)
  if (!ids.length) return { companyId, capabilitiesAdded: capabilities, pending: 0 }
  const { data, error } = await supabaseService.from('ediel_messages').select('*').in('id', ids)
  if (error) throw Error(`reality_pending_messages_read_failed: ${error.message}`)
  const rows = new Map((data as EdielMessageRow[]).map(row => [row.id, row]))
  const pending: Pending[] = []
  for (const id of ids) {
    const message = rows.get(id)!
    try { pending.push({ message, readiness: await getScopedEdielProductionReadiness(message) }) }
    catch (e) { pending.push({ message, refused: failure(e) }) }
  }
  const groups = new Map<string, { readiness: ScopedEdielReadiness; messages: EdielMessageRow[] }>()
  for (const p of pending) if (p.readiness) {
    const g = groups.get(p.readiness.dependencyHash) ?? { readiness: p.readiness, messages: [] }
    g.messages.push(p.message); groups.set(p.readiness.dependencyHash, g)
  }
  const describe = (g: { readiness: ScopedEdielReadiness; messages: EdielMessageRow[] }) => ({ scope: scopeLabel(g.readiness.scope),
    routeId: (g.readiness.dependencies.route as { id?: string } | undefined)?.id ?? null, dependencyHash: g.readiness.dependencyHash, messages: g.messages.length })
  const refused = pending.filter(p => p.refused).map(p => ({ messageId: p.message.id, scope: `${p.message.message_family}/${p.message.message_code}`, reason: p.refused }))
  const alreadyReady = [...groups.values()].filter(g => g.readiness.ready)

  const certRows = sql<CertRow[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'type',evidence_type,'bound',metadata->'edielScopedReadiness','validUntil',valid_until) ORDER BY evidence_type),'[]')
    FROM public.ediel_certification_evidence WHERE company_id=${literal(companyId)} AND environment='production' AND status='passed'
     AND engine_schema_version=public.canonical_current_ediel_engine_schema_version() AND metadata->>'reality_simulated'='true'`)
  const boundScope = certRows.find(r => r.bound?.scope)?.bound?.scope
  let certified: (ReturnType<typeof describe> & { evidenceId: string; expiresAt: string; voidedPreviousScope: string | null }) | null = null
  let target: { readiness: ScopedEdielReadiness; messages: EdielMessageRow[] } | undefined

  if (!alreadyReady.length && groups.size) {
    // F90: one (scope, route, release) per tenant. Re-certify the scope the rows already name if it
    // is pending (redeploy/route change), otherwise the scope of the oldest pending message.
    const candidates = [...groups.values()]
    const label = (g: { readiness: ScopedEdielReadiness }) => `${g.readiness.scope.family}/${g.readiness.scope.code}`
    target = candidates.find(g => boundScope && canonical(g.readiness.scope) === canonical(boundScope))
      ?? prefer.map(p => candidates.find(g => label(g) === p || scopeLabel(g.readiness.scope) === p)).find(Boolean)
      ?? candidates[0]
    const representative = target.messages[0]
    const expires = Math.min(Date.now() + PROOF_DAYS * 86_400_000, ...certRows.filter(r => r.validUntil).map(r => Date.parse(r.validUntil!)))
    const expiresAt = new Date(expires).toISOString()
    const payloadSha256 = sha256(representative.raw_payload ?? '')
    const { scope, dependencyHash } = target.readiness
    // What the test phase leaves on each certification row: the certified scope and dependency
    // hash, and the passed tests run against this exact release candidate.
    sql(`UPDATE public.ediel_certification_evidence SET metadata=metadata||jsonb_build_object('edielScopedReadiness',jsonb_build_object(
       'scope',${literal(scope)}::jsonb,'dependencyHash',${literal(dependencyHash)},'reality_simulated',true,'finding','F90',
       'tests',jsonb_build_array(jsonb_build_object('testId','reality-simulated-test-phase:'||evidence_type||':'||${literal(scopeLabel(scope))},
        'sourceRevision',${literal(sha)},'evidenceReference','reality://simulated-test-phase/'||company_id||'/'||evidence_type||'/'||${literal(dependencyHash)},
        'candidateSha',${literal(sha)},'result','passed','payloadSha256',${literal(payloadSha256)})))),updated_at=now()
      WHERE company_id=${literal(companyId)} AND id=ANY(${literal(`{${certRows.map(r => r.id).join(',')}}`)}::uuid[])`)
    const evidenceId = await recordScopedEdielProductionEvidence({ message: representative, expectedDependencyHash: dependencyHash,
      certificationEvidenceIds: certRows.map(r => r.id), expiresAt })
    const after = await getScopedEdielProductionReadiness(representative)
    if (!after.ready || after.evidenceId !== evidenceId) throw Error(`reality_scoped_certification_not_ready:${companyId}:${scopeLabel(scope)}`)
    const voided = boundScope && canonical(boundScope) !== canonical(scope) ? scopeLabel(boundScope as ScopedEdielReadiness['scope']) : null
    certified = { ...describe(target), evidenceId, expiresAt, voidedPreviousScope: voided }
  }
  const sendable = new Set([...alreadyReady, ...(target ? [target] : [])].map(g => g.readiness.dependencyHash))
  const unsendable = [...groups.values()].filter(g => !sendable.has(g.readiness.dependencyHash))
    .map(g => ({ ...describe(g), reason: 'F90: the certification rows can name one scope/route/release; they are bound to another pending scope' }))
  return { companyId, capabilitiesAdded: capabilities, pending: pending.length, alreadyReady: alreadyReady.map(describe), certified, unsendable, refused }
}

/**
 * Makes queued/draft production outbound messages of simulated-certified tenants pass the real
 * scoped gate (see the header). Idempotent: a tenant with a ready pending scope is left as is.
 */
export async function certifySimulatedEdielScopes(options: { prefer?: string[] } = {}): Promise<unknown> {
  const prefer = options.prefer ?? DEFAULT_PREFER
  const sha = releaseSha()
  const release = await ensureReleaseReceipt(sha)
  const tenants = sql<string[]>(`SELECT coalesce(jsonb_agg(DISTINCT company_id),'[]') FROM public.ediel_certification_evidence
    WHERE environment='production' AND status='passed' AND metadata->>'reality_simulated'='true'
     AND engine_schema_version=public.canonical_current_ediel_engine_schema_version()`)
  const results = []
  for (const companyId of tenants) {
    try { results.push(await certifyTenant(companyId, sha, prefer)) }
    catch (e) { results.push({ companyId, error: failure(e) }) }
  }
  return { release, tenants: results }
}
