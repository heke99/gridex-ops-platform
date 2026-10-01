import { beforeEach, expect, it, vi } from 'vitest'

const child = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync: child }))
// No Auth/SQL/network operation occurs in this controlled child boundary proof.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { proofSql } from '@/scripts/customer-read-proof-native'
import { customerProofSqlFailure } from '@/scripts/helpers/customer-proof-sqlstate-diagnostic-20261001'

const canary = 'SYN_PRIVATE_ROLE customer@example.invalid eyJ.synthetic.token postgres://secret SQL SELECT private'
const execute = proofSql as <T>(sql: string, stage?: string) => T
beforeEach(() => {
  vi.stubEnv('CI', 'true'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  child.mockReset(); child.mockReturnValue('true')
})
function failure(stderr?: string | Buffer) {
  child.mockImplementation(() => { throw Object.assign(new Error(canary), { stderr, stdout: canary }) })
}
it('actual child keeps ON_ERROR_STOP and requests SQLSTATE-only psql output', () => {
  expect(execute('SELECT to_jsonb(true);')).toBe(true)
  const args = child.mock.calls[0][1] as string[]
  expect(args).toEqual(expect.arrayContaining(['ON_ERROR_STOP=1', 'VERBOSITY=sqlstate']))
})
it('actual failed child exposes only its strict unique error-prefix state and fixed cleanup stage', () => {
  failure('psql:/private/seed.sql:9: ERROR:  23503\nDETAIL: ' + canary)
  expect(() => execute('SELECT ' + canary, 'lifecycle_cleanup_companies')).toThrow('customer_api_proof_database_failed stage=lifecycle_cleanup_companies sqlstate=23503')
})
it('actual failed child rejects duplicate state lines even when their codes match', () => {
  failure('ERROR: 23503\nERROR: 23503\n' + canary)
  expect(() => execute('SELECT 1;')).toThrow('customer_api_proof_database_failed stage=customer_sql sqlstate=UNKNOWN')
})
it('actual failed child never projects a forged DETAIL/message state or caller stage', () => {
  failure('ERROR: 23503\nDETAIL: ERROR: 42501\nCONTEXT: ' + canary)
  expect(() => execute(canary, canary)).toThrow('customer_api_proof_database_failed stage=UNKNOWN sqlstate=23503')
})
it('actual failed child accepts Buffer stderr while dropping all raw process context', () => {
  failure(Buffer.from('ERROR: 55000\nCONTEXT: ' + canary))
  expect(() => execute('SELECT 1;', 'lifecycle_cleanup_cases')).toThrow('customer_api_proof_database_failed stage=lifecycle_cleanup_cases sqlstate=55000')
})
it('unchanged successful JSON result control retains command, timeout and private stdio', () => {
  child.mockReturnValue('{"saved":true}')
  expect(execute('SELECT to_jsonb(true);')).toEqual({ saved: true })
  expect(child.mock.calls[0][2]).toMatchObject({ input: 'SELECT to_jsonb(true);', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] })
})
it('nonzero child still throws and does not expose raw context', () => {
  failure(canary)
  let caught: unknown
  try { execute(canary) } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toContain('customer_api_proof_database_failed')
  expect((caught as Error).message).not.toContain(canary)
})
it('malformed successful JSON still fails without exposing its raw output', () => {
  child.mockReturnValue(canary)
  expect(() => execute('SELECT 1;')).toThrow('customer_api_proof_database_failed')
})
it('current CI refusal remains before any child command', () => {
  vi.stubEnv('CI', 'false')
  expect(() => execute('SELECT 1;')).toThrow('disposable_local_only'); expect(child).not.toHaveBeenCalled()
})
it('current nonloopback refusal remains before any child command', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://external.example.invalid')
  expect(() => execute('SELECT 1;')).toThrow('disposable_local_only'); expect(child).not.toHaveBeenCalled()
})

it.each([
  ['ERROR: 42P01', '42P01'],
  ['psql:/private/canary.sql:7: FATAL:  08006', '08006'],
  ['PANIC: XX000', 'XX000'],
  ['ERROR: PT500', 'PT500'],
  ['ERROR: 00000', 'UNKNOWN'],
  ['ERROR: KARIN', 'UNKNOWN'],
  ['ERROR: PGRST205', 'UNKNOWN'],
  ['ERROR: ECONNRESET', 'UNKNOWN'],
  ['ERROR: 23503\nFATAL: 08006', 'UNKNOWN'],
  ['ERROR: 23503 private credentials', 'UNKNOWN'],
  ['DETAIL: ERROR: 23503\nCONTEXT: ' + canary, 'UNKNOWN'],
  ['ERROR: 23503\n' + 'x'.repeat(65_536), 'UNKNOWN'],
])('pure protocol projection of %s preserves only %s', (stderr, expected) => {
  expect(customerProofSqlFailure({ stderr, message: canary, stdout: canary, command: canary }, 'customer_sql'))
    .toBe(`customer_api_proof_database_failed stage=customer_sql sqlstate=${expected}`)
})
it('pure projection does not trust an error code without the strict child stderr prefix', () => {
  expect(customerProofSqlFailure({ code: '23503', message: canary }, canary))
    .toBe('customer_api_proof_database_failed stage=UNKNOWN sqlstate=UNKNOWN')
})
it('pure projection safely rejects an unreadable process object', () => {
  const error = Object.defineProperty({}, 'stderr', { get() { throw new Error(canary) } })
  expect(customerProofSqlFailure(error, 'customer_sql'))
    .toBe('customer_api_proof_database_failed stage=customer_sql sqlstate=UNKNOWN')
})
