import type { ChildProcessWithoutNullStreams } from 'node:child_process'

type Options = { marker: string; markerError: string; markerTimeoutMs?: number; lifetimeMs?: number; cleanupTimeoutMs?: number }

// PostgreSQL also owns a deadline: killing psql must not leave a backend
// blocked on a lock or idle inside the transaction until the runner expires.
export function nativeLockProcessEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PGOPTIONS: [process.env.PGOPTIONS, '-c statement_timeout=60000', '-c idle_in_transaction_session_timeout=60000'].filter(Boolean).join(' ') }
}

/** Own the disposable psql transaction even when readiness or its test fails. */
export function nativeLockProcess(child: ChildProcessWithoutNullStreams, options: Options) {
  const grace = options.cleanupTimeoutMs ?? 3000
  let exited = false, markerSeen = false, output = '', failure: Error | undefined
  let closing: Promise<void> | undefined
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveClosed!: () => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Preserve the original rejected promise for its caller, while also handling
  // a deadline reached during a synchronous native probe before await resumes.
  void ready.catch(() => undefined)
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  const markerTimer = setTimeout(() => fail(Error(options.markerError)), options.markerTimeoutMs ?? 10000)
  const lifetimeTimer = setTimeout(() => fail(Error('native_lock_process_lifetime_exceeded')), options.lifetimeMs ?? 60000)

  function fail(error: Error) {
    failure ??= error
    if (!markerSeen) rejectReady(failure)
    void dispose().catch(() => undefined)
  }
  function onData(chunk: Buffer) {
    output += String(chunk)
    if (!markerSeen && output.includes(options.marker)) {
      markerSeen = true
      clearTimeout(markerTimer)
      resolveReady()
    }
    output = output.slice(-Math.max(options.marker.length, 1))
  }
  function drain() { /* Keep stderr's pipe from blocking the owned process. */ }
  function onError(error: Error) { fail(error) }
  function stopObserving() {
    clearTimeout(markerTimer)
    clearTimeout(lifetimeTimer)
    child.stdout.off('data', onData)
    child.stderr.off('data', drain)
    child.off('error', onError)
    child.off('close', onClose)
    child.stdin.off('error', onError)
  }
  function onClose(code: number | null, signal: NodeJS.Signals | null) {
    exited = true
    stopObserving()
    if (code !== 0) failure ??= Error(`native_lock_process_exit:${code}:${signal}`)
    if (!markerSeen) rejectReady(failure ?? Error('native_lock_process_exited_before_marker'))
    resolveClosed()
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', drain)
  child.on('error', onError)
  child.once('close', onClose)
  child.stdin.on('error', onError)

  async function waitClosed() {
    if (exited) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([closed.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), grace) })])
    } finally { clearTimeout(timer) }
  }
  function finish(statement: 'COMMIT' | 'ROLLBACK') {
    closing ??= (async () => {
      if (exited) return
      if (!child.stdin.writableEnded && !child.stdin.destroyed) child.stdin.end(statement + ';\n')
      if (await waitClosed()) return
      failure ??= Error('native_lock_process_graceful_exit_timeout')
      child.kill('SIGTERM')
      if (await waitClosed()) return
      child.kill('SIGKILL')
      if (!await waitClosed()) {
        stopObserving()
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
        throw Error('native_lock_process_cleanup_timeout')
      }
    })()
    return closing
  }
  async function dispose() { await finish('ROLLBACK') }
  async function release(statement: 'COMMIT' | 'ROLLBACK') {
    await finish(failure ? 'ROLLBACK' : statement)
    if (failure) throw failure
  }
  return { ready, release, dispose }
}
