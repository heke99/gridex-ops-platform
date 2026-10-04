import { spawn } from 'node:child_process'

// Disposable regression processes must release their database connections even
// when a lock assertion fails. SIGKILL bounds a child that ignores SIGTERM.
export function startBoundedChild(command, args, { env = process.env, timeoutMs = 120000, graceMs = 1000, label = 'regression_child' } = {}) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let error = ''
  let timedOut = false
  let stopped = false
  let killTimer
  let deadline
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { error += chunk })
  const stop = () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) return
    stopped = true
    child.stdin.destroy()
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), graceMs)
  }
  const completion = new Promise(resolve => {
    const finished = (code, signal) => {
      clearTimeout(deadline)
      clearTimeout(killTimer)
      resolve({ code: timedOut ? 1 : code, signal, output, error, timedOut })
    }
    child.once('error', failure => {
      error += `${label}: ${failure.message}\n`
      finished(1, null)
    })
    child.once('close', finished)
  })
  deadline = setTimeout(() => {
    timedOut = true
    error += `${label}: process_timeout\n`
    stop()
  }, timeoutMs)
  return { child, completion, stop }
}
