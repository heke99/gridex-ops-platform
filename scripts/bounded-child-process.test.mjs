import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startBoundedChild } from './helpers/bounded-child-process.mjs'

const ignoringTermination = "process.on('SIGTERM',()=>{});process.stdout.write('READY\\n');setInterval(()=>{},25)"

test('captures actual child output and preserves failure exit status', async () => {
  const worker = startBoundedChild(process.execPath, ['-e', "process.stdout.write('answer');process.stderr.write('failure');process.exitCode=7"])
  worker.child.stdin.end()
  const result = await worker.completion
  assert.equal(result.code, 7)
  assert.equal(result.output, 'answer')
  assert.equal(result.error, 'failure')
  assert.equal(result.timedOut, false)
})

test('deadline kills a real child that ignores graceful termination', async () => {
  const worker = startBoundedChild(process.execPath, ['-e', ignoringTermination], { timeoutMs: 300, graceMs: 40 })
  worker.child.stdin.end()
  const result = await worker.completion
  assert.equal(result.output, 'READY\n')
  assert.equal(result.timedOut, true)
  assert.equal(result.signal, 'SIGKILL')
  assert.match(result.error, /process_timeout/)
})

test('failure cleanup is bounded and repeated stop is harmless', async () => {
  const worker = startBoundedChild(process.execPath, ['-e', ignoringTermination], { timeoutMs: 5000, graceMs: 40 })
  worker.child.stdin.end()
  await new Promise(resolve => worker.child.stdout.once('data', resolve))
  worker.stop()
  worker.stop()
  const result = await worker.completion
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(result.timedOut, false)
})
