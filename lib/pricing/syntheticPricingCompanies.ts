import { createHash } from 'node:crypto'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'

const MAX_BYTES = 8192
const declaration = 'SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT'
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
type ObjectValue = Record<string, unknown>
type Command = { name: string; slug: string; declaration: string }
export type SyntheticPricingCompanyReceipt = {
  company_id: string; birth_id: string; request_key: string; actor_user_id: string
  initial_name: string; initial_slug: string; declaration: string; command_sha256: string
  company_created_at: string; recorded_at: string; production_billing_prohibited: true
  external_financial_delivery_prohibited: true; consumer_enabled: false; replayed: boolean
}
class IntakeError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
const invalid = (): never => { throw new IntakeError(400, 'synthetic_pricing_company_invalid') }
const unqualified = (): never => { throw new IntakeError(502, 'synthetic_pricing_company_receipt_unqualified') }
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value)
function exact(value: unknown, keys: readonly string[], fail = invalid): ObjectValue {
  if (!object(value) || Object.keys(value).sort().join('\n') !== [...keys].sort().join('\n')) return fail()
  return value
}
export function syntheticCompanyUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return invalid()
  return value.toLowerCase()
}
function command(value: unknown): Command {
  const c = exact(value, ['name', 'slug', 'declaration'])
  if (typeof c.name !== 'string' || typeof c.slug !== 'string' || c.declaration !== declaration) return invalid()
  const characters = [...c.name]
  if (!characters.length || characters.length > 200 || c.name.trim() !== c.name || /[\u0000-\u001f\u007f-\u009f]/.test(c.name)
    || characters.some(character => character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff)
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(c.slug)) return invalid()
  return { name: c.name, slug: c.slug, declaration }
}
function commandHash(c: Command): string {
  const preimage = 'gridex-synthetic-pricing-company-command-v1\n' + [c.name, c.slug, c.declaration].map(value => Buffer.byteLength(value, 'utf8') + ':' + value).join('')
  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}
export async function readSyntheticCompanyBody(request: Request): Promise<Command> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = request.body?.getReader()
    if (!reader) return invalid()
    const parts: Buffer[] = []; let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      const part = Buffer.from(chunk.value); size += part.length
      if (size > MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new IntakeError(413, 'synthetic_pricing_company_too_large') }
      parts.push(part)
    }
    if (!size) return invalid()
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(parts, size))
    const value: unknown = JSON.parse(text)
    // Equality also rejects duplicate keys, escapes and all noncanonical whitespace.
    if (JSON.stringify(value) !== text) return invalid()
    return command(value)
  } catch (error) {
    if (error instanceof IntakeError) throw error
    return invalid()
  } finally { reader?.releaseLock() }
}
type RpcReply = { data: unknown; error: unknown }
interface BirthRpc {
  (name: 'gridex_create_synthetic_pricing_company_v1', args: { p_actor_user_id: string; p_request_key: string; p_name: string; p_slug: string; p_declaration: string }): PromiseLike<RpcReply>
  (name: 'gridex_read_synthetic_pricing_company_v1', args: { p_actor_user_id: string; p_request_key: string }): PromiseLike<RpcReply>
}
const rpc = () => supabaseService.rpc.bind(supabaseService) as unknown as BirthRpc
async function invoke(call: () => PromiseLike<RpcReply>): Promise<unknown> {
  try {
    const result = await call()
    if (!object(result) || !('data' in result) || !('error' in result)) return unqualified()
    if (result.error) {
      const code = object(result.error) ? result.error.code : null
      if (code === '42501') throw new IntakeError(403, 'synthetic_pricing_company_forbidden')
      if (code === 'P0002') throw new IntakeError(404, 'synthetic_pricing_company_not_found')
      if (code === '23505') throw new IntakeError(409, 'synthetic_pricing_company_conflict')
      if (code === '22023') return invalid()
      throw new IntakeError(503, 'synthetic_pricing_company_unavailable')
    }
    return result.data
  } catch (error) {
    if (error instanceof IntakeError) throw error
    throw new IntakeError(503, 'synthetic_pricing_company_unconfirmed')
  }
}
const receiptKeys = ['company_id', 'birth_id', 'request_key', 'actor_user_id', 'initial_name', 'initial_slug', 'declaration', 'command_sha256', 'company_created_at', 'recorded_at', 'production_billing_prohibited', 'external_financial_delivery_prohibited', 'consumer_enabled', 'replayed'] as const
function instant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}
function receipt(value: unknown, actorId: string, requestKey: string, expected?: Command): SyntheticPricingCompanyReceipt {
  const r = exact(value, receiptKeys, unqualified)
  try {
    const original = command({ name: r.initial_name, slug: r.initial_slug, declaration: r.declaration })
    if (![r.company_id, r.birth_id, r.request_key, r.actor_user_id].every(id => typeof id === 'string' && uuidPattern.test(id))
      || r.request_key !== requestKey || r.actor_user_id !== actorId || r.command_sha256 !== commandHash(original)
      || !instant(r.company_created_at) || !instant(r.recorded_at) || r.recorded_at < r.company_created_at || r.production_billing_prohibited !== true
      || r.external_financial_delivery_prohibited !== true || r.consumer_enabled !== false || typeof r.replayed !== 'boolean'
      || expected && (original.name !== expected.name || original.slug !== expected.slug || original.declaration !== expected.declaration)) return unqualified()
  } catch { return unqualified() }
  return Object.fromEntries(receiptKeys.map(key => [key, r[key]])) as SyntheticPricingCompanyReceipt
}
export async function createSyntheticPricingCompany(actorId: string, requestKey: string, input: Command): Promise<SyntheticPricingCompanyReceipt> {
  const c = command(input), actor = syntheticCompanyUuid(actorId), key = syntheticCompanyUuid(requestKey)
  return receipt(await invoke(() => rpc()('gridex_create_synthetic_pricing_company_v1', { p_actor_user_id: actor, p_request_key: key, p_name: c.name, p_slug: c.slug, p_declaration: c.declaration })), actor, key, c)
}
export async function readSyntheticPricingCompany(actorId: string, requestKey: string): Promise<SyntheticPricingCompanyReceipt> {
  const actor = syntheticCompanyUuid(actorId), key = syntheticCompanyUuid(requestKey)
  const result = receipt(await invoke(() => rpc()('gridex_read_synthetic_pricing_company_v1', { p_actor_user_id: actor, p_request_key: key })), actor, key)
  if (result.replayed) return unqualified()
  return result
}
export function syntheticCompanyJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: privateHeaders }) }
export async function syntheticCompanyHttp(operation: (actorId: string) => Promise<Response>): Promise<Response> {
  try {
    const access = await requireAdminApiAccess([])
    if (access.response) return new Response(access.response.body, { status: access.response.status, headers: { ...Object.fromEntries(access.response.headers), ...privateHeaders } })
    if (access.guard.isPlatformAdmin !== true || !uuidPattern.test(access.guard.userId)) throw new IntakeError(403, 'synthetic_pricing_company_forbidden')
    return await operation(access.guard.userId)
  } catch (error) {
    const known = error instanceof IntakeError ? error : new IntakeError(503, 'synthetic_pricing_company_unavailable')
    return syntheticCompanyJson({ error: known.code, code: known.code }, known.status)
  }
}
