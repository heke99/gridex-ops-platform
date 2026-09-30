import nodemailer from 'nodemailer'
import { expect, it } from 'vitest'

it('composes authored mail and an Ediel attachment entirely in memory', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
  const payload = Buffer.from("UNB+SYNTHETIC'UNZ+1'")
  const sent = await transport.sendMail({
    from: 'Gridex <sender@example.invalid>',
    to: 'receiver@example.invalid',
    subject: 'Synthetic compatibility check',
    text: 'Synthetic plain text',
    html: '<p>Synthetic HTML</p>',
    attachments: [{ filename: 'message.edi', content: payload, contentType: 'application/edifact' }],
  })
  expect(sent.envelope).toEqual({ from: 'sender@example.invalid', to: ['receiver@example.invalid'] })
  if (!Buffer.isBuffer(sent.message)) throw new Error('The in-memory transport must return a Buffer')
  const mime = sent.message.toString()
  expect(mime).toContain('Synthetic plain text')
  expect(mime).toContain('<p>Synthetic HTML</p>')
  expect(mime).toContain('application/edifact')
  expect(mime).toContain('filename=message.edi')
  expect(mime).toContain(payload.toString('base64'))
})

it('preserves raw MIME bytes and the explicit SMTP envelope entirely in memory', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true })
  const raw = Buffer.from('From: sender@example.invalid\r\nTo: receiver@example.invalid\r\nSubject: Synthetic raw MIME\r\n\r\nSynthetic exact bytes\r\n')
  const sent = await transport.sendMail({
    envelope: { from: 'sender@example.invalid', to: ['receiver@example.invalid'] },
    raw,
  })
  expect(sent.envelope).toEqual({ from: 'sender@example.invalid', to: ['receiver@example.invalid'] })
  if (!Buffer.isBuffer(sent.message)) throw new Error('The in-memory transport must return a Buffer')
  expect(sent.message.equals(raw)).toBe(true)
})
