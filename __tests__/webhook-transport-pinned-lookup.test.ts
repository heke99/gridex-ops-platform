// bug-hunt P1: pinned DNS lookup must work with Node 22 autoSelectFamily ({ all: true })
import net from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { pinnedLookup } from '@/lib/integrations/publicWebhookTransport'

let server: net.Server
let port = 0
beforeAll(async () => {
  server = net.createServer((socket) => socket.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as net.AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

it('connects through a hostname via the pinned lookup (all: true path; loopback name so the unit network boundary allows it)', async () => {
  const data = await new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: 'localhost', port, lookup: pinnedLookup({ address: '127.0.0.1', family: 4 }) as never, autoSelectFamily: true })
    let out = ''
    socket.on('data', (chunk) => { out += chunk })
    socket.on('end', () => resolve(out))
    socket.on('error', reject)
  })
  expect(data).toBe('ok')
})

it('still answers the single-address form', () => {
  let args: unknown[] = []
  pinnedLookup({ address: '93.184.216.34', family: 4 })('h', {}, (...a: unknown[]) => { args = a })
  expect(args).toEqual([null, '93.184.216.34', 4])
})
