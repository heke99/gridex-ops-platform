// Lokala syntetiska motparter (en HTTP-process, inga externa värdar).
//   /papilite/*       geokodning (PAPILITE_GEOCODE_URL)      -> 200 []
//   /lantmateriet/*   belägenhetsadress                      -> 200 {"features":[]}
//   /svk/*, /spot/*   SVK/spotpriser                         -> 404 (scenarier skriver syntetiska rader i DB)
//   /grid-owner/*     nätägare                               -> 404 (samma skäl)
//   /supplier-files/* mottagare av leverantörsfiler          -> POST/PUT sparas under SIM_HOME/counterparts/received/
//   GET /__requests   alla mottagna anrop (JSON)             GET /__health
// Varje anrop loggas till SIM_HOME/counterparts/requests.jsonl så att scenarier kan visa att
// appen anropade just motparten och inget externt.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const home = process.env.SIM_HOME
const port = Number(process.env.SIM_COUNTERPART_PORT ?? 3195)
if (!home) throw new Error('SIM_HOME saknas')
const dir = path.join(home, 'counterparts')
const received = path.join(dir, 'received')
fs.mkdirSync(received, { recursive: true })
const logFile = path.join(dir, 'requests.jsonl')

http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const url = new URL(req.url ?? '/', 'http://x')
    const entry = {
      at: new Date().toISOString(), method: req.method, path: url.pathname, query: url.search,
      bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'),
    }
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/__health') return json(200, { ok: true })
    if (url.pathname === '/__requests') {
      const rows = fs.existsSync(logFile)
        ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
      return json(200, rows)
    }
    if (url.pathname.startsWith('/supplier-files/') && (req.method === 'POST' || req.method === 'PUT')) {
      const name = `${Date.now()}-${entry.sha256.slice(0, 12)}-${path.basename(url.pathname) || 'file'}`
      fs.writeFileSync(path.join(received, name), body)
      entry.stored = name
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
      return json(201, { stored: name, sha256: entry.sha256, bytes: body.length })
    }
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
    if (url.pathname.startsWith('/papilite')) return json(200, [])
    if (url.pathname.startsWith('/lantmateriet')) return json(200, { features: [] })
    return json(404, { error: 'synthetic counterpart: no data; scenarios write synthetic rows directly to the stack DB' })
  })
}).listen(port, '127.0.0.1', () => console.log(`counterparts listening on 127.0.0.1:${port}`))
