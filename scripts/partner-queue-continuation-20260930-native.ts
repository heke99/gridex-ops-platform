import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
export function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || !process.env.GRIDEX_NATIVE_STATUS ||
    JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')).API_URL !== 'http://127.0.0.1:54321') {
    throw new Error('partner_queue_continuation_disposable_replay_required')
  }
  return JSON.parse(execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 20_000,
  }).trim()) as T
}
export function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part })
  // Process exit can precede the last stdout/stderr data event. Consumers parse
  // output only after this promise, so wait for the pipes to finish too.
  const exited = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? -1)) })
  return { child, exited, output: () => ({ stdout, stderr }) }
}
export async function until(predicate: () => boolean, reason: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(reason)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
