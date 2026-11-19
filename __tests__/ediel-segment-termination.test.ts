import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'

const externalIo = vi.hoisted(() => vi.fn(() => {
  throw new Error('External I/O is outside this synthetic MIME fixture')
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: externalIo, rpc: externalIo } }))

beforeEach(() => vi.stubGlobal('fetch', externalIo))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const framings = [
  { name: 'standard delimiter', terminator: "'" },
  { name: 'declared UNA delimiter', terminator: '~' },
]

function e66Message(terminator: string) {
  const message = energyHandoffMessage('2026-11-18')
  const raw = message.raw_payload!.replace("++23-DDQ-E66-T++1'", "++23-DDQ-E66-T++1++1'")
    .replaceAll(/(?<!\?)'/g, terminator)
  expect(raw.startsWith('UNA:+.? ' + terminator)).toBe(true)
  expect(raw.endsWith(terminator)).toBe(true)
  return { ...message, raw_payload: raw }
}

function readBodyThroughMime(payload: string): string {
  const rawEmail = `Subject: synthetic E66\nContent-Type: text/plain; charset=us-ascii\n\n${payload}`
  const mime = splitMimeParts(rawEmail)
  const inbound = parseInboundEmailContent({
    rawEmail, bodyText: mime.bodyText, attachmentText: mime.rawEdifactPayload,
  })
  expect(inbound?.rawPayload).toBe(payload)
  return inbound!.rawPayload
}

it.each(framings)('keeps complete E66 MIME originals with the $name accepted', ({ terminator }) => {
  const message = e66Message(terminator)
  message.raw_payload = readBodyThroughMime(message.raw_payload)

  expect(resolveCanonicalRuntimeDecision(message)).toMatchObject({
    syntaxDecision: 'accepted',
    responsePlan: [
      { family: 'CONTRL', outcome: 'positive' },
      { family: 'APERAK', outcome: 'positive' },
    ],
  })
  expect(runUtiltsRuntimeForMessage(message).validation.syntaxOk).toBe(true)
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(framings)('plans only negative CONTRL when the final $name is missing', ({ terminator }) => {
  const message = e66Message(terminator)
  const payload = message.raw_payload.slice(0, -1)
  message.raw_payload = readBodyThroughMime(payload)

  expect(resolveCanonicalRuntimeDecision(message)).toMatchObject({
    syntaxDecision: 'rejected',
    applicationDecision: 'not_applicable',
    functionalDecision: 'not_applicable',
    responsePlan: [{ family: 'CONTRL', outcome: 'negative' }],
  })
  const runtime = runUtiltsRuntimeForMessage(message)
  expect(runtime.validation.syntaxOk).toBe(false)
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({
    code: 'unterminated_unz_segment',
    kind: 'syntax',
  }))
  expect(message.raw_payload).toBe(payload)
  expect(externalIo).not.toHaveBeenCalled()
})

it.each(framings)('does not treat trailing whitespace as the $name', ({ terminator }) => {
  const message = e66Message(terminator)
  const whitespace = '\r\n\t '
  expect(validateEdifactSyntax({ ...message, raw_payload: message.raw_payload + whitespace }).ok).toBe(true)

  const missingTerminator = message.raw_payload.slice(0, -1) + whitespace
  const syntax = validateEdifactSyntax({ ...message, raw_payload: missingTerminator })
  expect(syntax.ok).toBe(false)
  expect(syntax.issues).toContainEqual(expect.objectContaining({
    code: 'unterminated_unz_segment',
    severity: 'error',
  }))
})
