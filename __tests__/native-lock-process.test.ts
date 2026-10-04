import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { nativeLockProcess } from '../scripts/helpers/native-lock-process'

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
function child(code: string) { return spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'pipe'] }) }
async function forceClose(proc: ChildProcessWithoutNullStreams) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const closed = once(proc, 'close')
  proc.kill('SIGKILL')
  await closed
}

it('marker timeout rejects and closes a process which ignores rollback and SIGTERM', async () => {
  const proc = child("process.on('SIGTERM',()=>{});process.stdin.resume();console.log('STARTED');setInterval(()=>{},1000)")
  await once(proc.stdout, 'data')
  const closedProcess = once(proc, 'close')
  const lock = nativeLockProcess(proc, { marker: 'LOCKED', markerError: 'expected_marker_timeout', markerTimeoutMs: 50, cleanupTimeoutMs: 30 })
  try {
    await expect(lock.ready).rejects.toThrow('expected_marker_timeout')
    const closed = await Promise.race([closedProcess.then(() => true), delay(700).then(() => false)])
    expect(closed, 'marker failure must release the child within a fixed cleanup bound').toBe(true)
    expect(proc.signalCode).toBe('SIGKILL')
    expect(proc.stdout.listenerCount('data')).toBe(0)
  } finally { await forceClose(proc) }
})

it('cleanup closes a ready process which ignores graceful exit and SIGTERM', async () => {
  const proc = child("process.on('SIGTERM',()=>{});process.stdin.resume();setTimeout(()=>console.log('LOCKED'),25);setInterval(()=>{},1000)")
  const lock = nativeLockProcess(proc, { marker: 'LOCKED', markerError: 'unexpected_marker_timeout', markerTimeoutMs: 500, cleanupTimeoutMs: 30 })
  try {
    await lock.ready
    const closed = await Promise.race([lock.dispose().then(() => true), delay(700).then(() => false)])
    expect(closed, 'cleanup must force exit rather than await an open child forever').toBe(true)
    expect(proc.signalCode).toBe('SIGKILL')
  } finally { await forceClose(proc) }
})

it('recognizes a split marker and waits for a successful commit before release', async () => {
  const proc = child("process.stdout.write('LOC');setTimeout(()=>process.stdout.write('KED'),25);process.stdin.on('data',data=>process.exit(String(data).includes('COMMIT')?0:1))")
  const lock = nativeLockProcess(proc, { marker: 'LOCKED', markerError: 'unexpected_marker_timeout', markerTimeoutMs: 500, cleanupTimeoutMs: 100 })
  try {
    await lock.ready
    await lock.release('COMMIT')
    expect(proc.exitCode).toBe(0)
    expect(proc.stdout.listenerCount('data')).toBe(0)
  } finally { await lock.dispose(); await forceClose(proc) }
})

it.each([0, 3])('rejects exit code %s before readiness instead of waiting for a marker forever', async code => {
  const proc = child(`process.exit(${code})`)
  const lock = nativeLockProcess(proc, { marker: 'LOCKED', markerError: 'unexpected_marker_timeout', markerTimeoutMs: 500 })
  try { await expect(lock.ready).rejects.toThrow(code === 0 ? 'native_lock_process_exited_before_marker' : 'native_lock_process_exit:3') }
  finally { await lock.dispose(); await forceClose(proc) }
})

it('lifetime expiry closes an abandoned ready process and rejects a later commit', async () => {
  const proc = child("process.on('SIGTERM',()=>{});process.stdin.resume();console.log('LOCKED');setInterval(()=>{},1000)")
  const lock = nativeLockProcess(proc, { marker: 'LOCKED', markerError: 'unexpected_marker_timeout', markerTimeoutMs: 500, lifetimeMs: 200, cleanupTimeoutMs: 30 })
  const closed = once(proc, 'close')
  try {
    await lock.ready
    await closed
    expect(proc.signalCode).toBe('SIGKILL')
    await expect(lock.release('COMMIT')).rejects.toThrow('native_lock_process_lifetime_exceeded')
  } finally { await lock.dispose(); await forceClose(proc) }
})
