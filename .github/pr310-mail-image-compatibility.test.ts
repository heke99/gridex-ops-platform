import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import nodemailer from 'nodemailer'
import type StreamTransport from 'nodemailer/lib/stream-transport'
import { ImapFlow } from 'imapflow'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

// No production credentials, external host, SMTP delivery or application writes.
const rawEmail = Buffer.from(
  'From: sender@example.invalid\r\nTo: receiver@example.invalid\r\n' +
  'Subject: Local dependency witness\r\nMessage-ID: <witness@example.invalid>\r\n' +
  '\r\nUNH+1+UTILTS:D:96A:UN:EDIEL2\'\r\n',
)

describe('patched production dependency compatibility', () => {
  it('preserves structured and raw Ediel MIME through the real mail composer', async () => {
    const options: StreamTransport.Options = {
      streamTransport: true, buffer: true, newline: 'windows',
    }
    const transporter = nodemailer.createTransport(options)
    try {
      const composed = await transporter.sendMail({
        from: 'sender@example.invalid', to: 'receiver@example.invalid',
        subject: 'Mätvärde', text: 'Local fixture',
        attachments: [{ filename: 'witness.edi', content: rawEmail }],
      })
      expect(composed.envelope).toEqual({
        from: 'sender@example.invalid', to: ['receiver@example.invalid'],
      })
      expect(Buffer.isBuffer(composed.message)).toBe(true)
      const mime = composed.message.toString()
      expect(mime).toContain('filename=witness.edi')
      expect(mime.replace(/\r\n/g, '')).toContain(rawEmail.toString('base64'))
      const raw = await transporter.sendMail({
        envelope: { from: 'sender@example.invalid', to: ['receiver@example.invalid'] },
        raw: rawEmail,
      })
      expect(Buffer.isBuffer(raw.message)).toBe(true)
      expect(raw.message.toString()).toBe(rawEmail.toString())
    } finally {
      transporter.close()
    }
  })

  it('preserves IMAP lock, UID fetch, raw source and Seen flags on loopback only', async () => {
    const sockets = new Set<Socket>()
    const commands: string[] = []
    const unsupported: string[] = []
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => { /* Cleanup also destroys failed fixture sockets. */ })
      socket.setEncoding('utf8')
      socket.write('* OK local fixture ready\r\n')
      let pending = ''
      socket.on('data', (chunk: string) => {
        pending += chunk
        for (;;) {
          const end = pending.indexOf('\r\n')
          if (end < 0) break
          const line = pending.slice(0, end)
          pending = pending.slice(end + 2)
          const split = line.indexOf(' ')
          const tag = line.slice(0, split)
          const command = line.slice(split + 1)
          commands.push(command)
          if (command === 'CAPABILITY') {
            socket.write(`* CAPABILITY IMAP4rev1 UIDPLUS\r\n${tag} OK CAPABILITY\r\n`)
          } else if (command.startsWith('LOGIN ')) {
            socket.write(`${tag} OK LOGIN\r\n`)
          } else if (command.startsWith('LIST ')) {
            socket.write(`* LIST () "/" "INBOX"\r\n${tag} OK LIST\r\n`)
          } else if (command.startsWith('SELECT ')) {
            socket.write('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* 0 RECENT\r\n' +
              '* OK [PERMANENTFLAGS (\\Seen)] flags\r\n* OK [UIDVALIDITY 1] valid\r\n' +
              `* OK [UIDNEXT 8] next\r\n${tag} OK [READ-WRITE] SELECT\r\n`)
          } else if (command.startsWith('UID FETCH 7 ')) {
            socket.write(`* 1 FETCH (UID 7 FLAGS () BODY[] {${rawEmail.length}}\r\n`)
            socket.write(rawEmail)
            socket.write(`)\r\n${tag} OK FETCH\r\n`)
          } else if (command.startsWith('UID STORE 7 ')) {
            socket.write(`${tag} OK STORE\r\n`)
          } else if (command === 'LOGOUT') {
            socket.end(`* BYE fixture complete\r\n${tag} OK LOGOUT\r\n`)
          } else if (command === 'NOOP') {
            socket.write(`${tag} OK NOOP\r\n`)
          } else {
            unsupported.push(command)
            socket.write(`${tag} BAD unsupported fixture command\r\n`)
          }
        }
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback address required')
    const client = new ImapFlow({
      host: '127.0.0.1', port: address.port, secure: false, doSTARTTLS: false,
      auth: { user: 'fixture', pass: 'fixture-only' }, logger: false,
      connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000,
      disableAutoIdle: true,
    })
    client.on('error', () => { /* Awaited operations assert fixture errors. */ })
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const messages = []
        for await (const message of client.fetch('7', { uid: true, source: true, flags: true }, { uid: true })) {
          messages.push(message)
        }
        expect(messages).toHaveLength(1)
        expect(messages[0].uid).toBe(7)
        expect(messages[0].source).toEqual(rawEmail)
        await client.messageFlagsAdd('7', ['\\Seen'], { uid: true })
      } finally {
        lock.release()
      }
      await client.logout()
      expect(unsupported).toEqual([])
      expect(commands.some((command) => command.startsWith('UID FETCH 7 '))).toBe(true)
      expect(commands.some((command) => command.startsWith('UID STORE 7 ') && command.includes('\\Seen'))).toBe(true)
    } finally {
      client.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15000)

  it('encodes and decodes AVIF with the patched native image dependency', async () => {
    const image = await sharp({ create: {
      width: 2, height: 2, channels: 3, background: { r: 20, g: 40, b: 60 },
    } }).avif().toBuffer()
    const decoded = await sharp(image).png().toBuffer()
    const metadata = await sharp(decoded).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.width).toBe(2)
    expect(metadata.height).toBe(2)
  })
})
