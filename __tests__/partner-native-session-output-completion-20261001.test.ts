import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ script: '', unavailable: false, calls: [] as Array<[string, string[]]> }))
// Substitute only the psql executable with a real Node subprocess. The actual
// exported session owns real ChildProcess events and pipe collection; no
// database, transaction, claim result or PostgreSQL behavior is simulated.
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn(command: string, args: string[]) {
    boundary.calls.push([command, args])
    return boundary.unavailable
      ? actual.spawn('/synthetic-nonexistent-native-executable', [])
      : actual.spawn(process.execPath, ['-e', boundary.script])
  } }
})
import { session } from '../scripts/partner-queue-continuation-20260930-native'

beforeEach(() => { boundary.script = ''; boundary.unavailable = false; boundary.calls = [] })

it('the actual session waits for inherited output pipes after the main process exits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-session-output-')), gate = join(directory, 'release')
  const writer = `const fs=require('node:fs'), gate=${JSON.stringify(gate)};
    const deadline=Date.now()+3000;
    const timer=setInterval(()=>{
      if(fs.existsSync(gate)){clearInterval(timer);process.stdout.write('[{"id":"SYN_FINAL_CLAIM"}]\\n');process.stderr.write('SYN_FINAL_DIAGNOSTIC\\n');}
      else if(Date.now()>deadline){clearInterval(timer);process.exit(2);}
    },5);`
  boundary.script = `const {spawn}=require('node:child_process');
    const writer=spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:['ignore',1,2]});
    writer.unref();process.exit(0);`
  const connection = session('synthetic_output_completion'), closed = once(connection.child, 'close')
  let completed = false
  void connection.exited.then(() => { completed = true })
  try {
    await once(connection.child, 'exit')
    await Promise.resolve()
    expect(connection.output().stdout).toBe('')
    expect(completed).toBe(false)
    writeFileSync(gate, 'release')
    expect(await connection.exited).toBe(0)
    expect(JSON.parse(connection.output().stdout)).toEqual([{ id: 'SYN_FINAL_CLAIM' }])
    expect(connection.output().stderr).toContain('SYN_FINAL_DIAGNOSTIC\n')
    expect(boundary.calls).toEqual([['psql', [
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres?application_name=synthetic_output_completion',
      '-XAtq', '-v', 'ON_ERROR_STOP=1',
    ]]])
  } finally {
    writeFileSync(gate, 'release')
    await closed
    rmSync(directory, { recursive: true, force: true })
  }
})

it('the actual session preserves a nonzero process result and its final diagnostics', async () => {
  boundary.script = `process.stdout.write('[]\\n');process.stderr.write('SYN_DATABASE_FAILURE\\n');process.exitCode=7;`
  const connection = session('synthetic_nonzero_completion')
  expect(await connection.exited).toBe(7)
  expect(connection.output().stdout).toBe('[]\n')
  expect(connection.output().stderr).toContain('SYN_DATABASE_FAILURE\n')
})

it('the actual session rejects an executable startup failure', async () => {
  boundary.unavailable = true
  const connection = session('synthetic_spawn_error')
  await expect(connection.exited).rejects.toMatchObject({ code: 'ENOENT' })
})
