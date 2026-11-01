// Local synthetic counterparty sink. Every external base URL in SIM_HOME/env (mail API, spot prices,
// geocoding, supplier file receiver) points here, so an accidental outbound call from the app lands on
// loopback and is recorded instead of leaving the machine. Nothing in the T4 billing scenarios is
// expected to call it; run.sh reports the number of recorded requests.
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const port = Number(process.env.T4_SINK_PORT ?? 3194)
const log = process.env.T4_SINK_LOG
if (!log) throw new Error('T4_SINK_LOG is required')

createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, bytes: Buffer.concat(chunks).length }) + '\n')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
}).listen(port, '127.0.0.1')
