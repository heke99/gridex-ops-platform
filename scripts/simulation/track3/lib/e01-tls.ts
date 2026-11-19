// EDIEL01.04: hjälpare för negativa TLS-prov. Startar lokala lyssnare på 127.0.0.1 (slumpad port):
//  * untrusted-tls: implicit TLS med servercert från en ANNAN, okänd CA (skapad med openssl i en tillfällig katalog;
//    privata nycklar lämnar aldrig den katalogen och tas bort av close()). Räknar lyckade handskakningar, TLS-klientfel
//    och applikationsdata.
//  * plain-smtp: klartext-SMTP utan STARTTLS. Loggar varje rad klienten skickar (MAIL FROM/RCPT/DATA/AUTH).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls'

export type AltListenerLog = {
  port: number
  connections: number
  secureHandshakes: number
  tlsClientErrors: string[]
  appBytes: number
  smtpCommands: string[]
}
export type AltListener = { port: number; log: AltListenerLog; close: () => Promise<void> }

const listen = (server: NetServer | TlsServer): Promise<number> =>
  new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)) })
const closeServer = (server: NetServer | TlsServer, sockets: Set<Socket>): Promise<void> =>
  new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()) })

/** Fabricerar en CA + servercert (127.0.0.1/localhost) som INTE är spårets CA. */
function makeUnknownCa(dir: string): { key: Buffer; cert: Buffer } {
  const sh = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=T3SIM unknown CA (negative test)'])
  sh(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=127.0.0.1'])
  const ext = join(dir, 'ext.cnf')
  execFileSync('bash', ['-c', `printf 'subjectAltName=IP:127.0.0.1,DNS:localhost\\n' > ext.cnf`], { cwd: dir })
  sh(['x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', ext])
  return { key: readFileSync(join(dir, 'srv.key')), cert: readFileSync(join(dir, 'srv.pem')) }
}

export async function startUntrustedTlsListener(banner = '220 untrusted ESMTP ready'): Promise<AltListener> {
  const dir = mkdtempSync(join(tmpdir(), 't3-e01-ca-'))
  const { key, cert } = makeUnknownCa(dir)
  const log: AltListenerLog = { port: 0, connections: 0, secureHandshakes: 0, tlsClientErrors: [], appBytes: 0, smtpCommands: [] }
  const sockets = new Set<Socket>()
  const server = createTlsServer({ key, cert, minVersion: 'TLSv1.2' }, (socket) => {
    log.secureHandshakes++
    sockets.add(socket)
    socket.write(`${banner}\r\n`)
    socket.on('data', (d) => { log.appBytes += d.length; for (const line of d.toString('latin1').split(/\r?\n/)) if (line.trim()) log.smtpCommands.push(line.trim().slice(0, 120)) })
    socket.on('error', () => undefined)
  })
  server.on('connection', (s) => { log.connections++; sockets.add(s); s.on('error', () => undefined) })
  server.on('tlsClientError', (err) => { log.tlsClientErrors.push(String((err as { code?: string }).code ?? err.message)) })
  log.port = await listen(server)
  return { port: log.port, log, close: async () => { await closeServer(server, sockets); rmSync(dir, { recursive: true, force: true }) } }
}

export async function startPlainSmtpListener(): Promise<AltListener> {
  const log: AltListenerLog = { port: 0, connections: 0, secureHandshakes: 0, tlsClientErrors: [], appBytes: 0, smtpCommands: [] }
  const sockets = new Set<Socket>()
  const server = createNetServer((socket) => {
    log.connections++
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.write('220 plain.t3.sim ESMTP (no STARTTLS)\r\n')
    let buf = ''
    socket.on('data', (d) => {
      log.appBytes += d.length
      buf += d.toString('latin1')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        log.smtpCommands.push(line.slice(0, 120))
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250-plain.t3.sim\r\n250 AUTH PLAIN LOGIN\r\n')
        else if (/^QUIT/i.test(line)) { socket.write('221 bye\r\n'); socket.end() }
        else socket.write('530 5.7.0 Must issue a STARTTLS command first\r\n')
      }
    })
  })
  log.port = await listen(server)
  return { port: log.port, log, close: () => closeServer(server, sockets) }
}
