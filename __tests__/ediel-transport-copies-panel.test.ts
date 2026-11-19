import React, { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[], fetch: vi.fn() }))
// The component, click handler and React-rendered markup are real. Hook state
// and the established HTTP read are controlled synthetic inputs.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = io.cursor++
    if (!(index in io.state)) io.state[index] = initial
    return [io.state[index], (value: unknown) => {
      io.state[index] = typeof value === 'function' ? value(io.state[index]) : value
    }]
  },
}))

import EdielTransportCopiesPanel from '@/components/admin/ediel/EdielTransportCopiesPanel'

const messageId = '00000000-0000-4000-8000-000000000001'
const otherMessageId = '00000000-0000-4000-8000-000000000002'
const attemptId = '00000000-0000-4000-8000-000000000003'
const olderAttemptId = '00000000-0000-4000-8000-000000000004'
const endpoint = `/api/ediel/messages/${messageId}/transport-copy`
const tracking = {
  caseId: '00000000-0000-4000-8000-000000000005', attemptId, lane: 'generic_journal', reason: 'entry_unresolved_after_lease',
  status: 'needs_tracking', enteredAt: '2026-11-18T10:00:00Z', openedAt: '2026-11-18T10:20:00Z',
  observedAt: null, observedClassification: null, authorizesResend: false, deliveryProven: false,
}
const olderCopy = {
  attemptId: olderAttemptId, mimeSha256: 'b'.repeat(64), mimeLength: 52, rfcMessageId: '<fixture@example.invalid>',
  enteredAt: '2026-11-17T10:00:00Z', observedAt: '2026-11-17T10:01:00Z', smtpClassification: 'accepted',
}

type ButtonProps = { onClick?: () => Promise<void>; children?: ReactNode; disabled?: boolean }
function loadButton(node: ReactNode): ButtonProps | undefined {
  if (!isValidElement<ButtonProps>(node)) return undefined
  if (node.type === 'button' && node.props.onClick) return node.props
  for (const child of Children.toArray(node.props.children)) {
    const button = loadButton(child)
    if (button) return button
  }
}

function panel(id = messageId) {
  io.cursor = 0
  return EdielTransportCopiesPanel({ messageId: id })
}

function deferRead() {
  let resolve!: (response: Response) => void
  const response = new Promise<Response>(complete => { resolve = complete })
  io.fetch.mockReturnValueOnce(response)
  return resolve
}

async function load(response: Response) {
  io.fetch.mockResolvedValueOnce(response)
  const button = loadButton(panel())
  if (!button?.onClick) throw new Error('fixture_transport_load_button_missing')
  await button.onClick()
  return renderToStaticMarkup(panel())
}

beforeEach(() => {
  io.cursor = 0
  io.state = []
  io.fetch.mockReset()
  vi.stubGlobal('fetch', io.fetch)
  vi.stubGlobal('React', React)
})
afterEach(() => vi.unstubAllGlobals())

describe('Ediel transport reconciliation panel', () => {
  it.each(['held', 'unavailable'])('shows the actual tracking attempt when verified transport copies are %s', async status => {
    const html = await load(Response.json({ status, copies: [olderCopy], reconciliationCases: [tracking] }))
    expect(io.fetch).toHaveBeenCalledExactlyOnceWith(endpoint, { cache: 'no-store', credentials: 'same-origin' })
    expect(html).toContain('Behöver avstämmas')
    expect(html).toContain(attemptId)
    expect(html).toContain('Ingen verifierad transportkopia är tillgänglig för det valda bolaget.')
    expect(html).not.toMatch(/Hämta arkiverad MIME-fil|Inga avstämningsärenden|Skicka om/)
    expect(html).not.toContain(olderAttemptId)
    expect(renderToStaticMarkup(panel(otherMessageId))).not.toContain(attemptId)
  })

  it('keeps a verified older download separate from a later observed case', async () => {
    const observed = { ...tracking, status: 'outcome_observed', observedClassification: 'accepted', observedAt: '2026-11-18T10:21:00Z' }
    const html = await load(Response.json({ status: 'available', copies: [olderCopy], reconciliationCases: [observed] }))
    expect(html).toContain('SMTP-utfall observerat')
    expect(html).toContain(attemptId)
    expect(html).toContain(`href="${endpoint}?attemptId=${olderAttemptId}"`)
    expect(html).not.toContain(`?attemptId=${attemptId}`)
    expect(html).not.toMatch(/Leverans bekräftad|Skicka om/)
  })

  it('distinguishes a verified empty case list from an unavailable case list', async () => {
    const available = { status: 'available', copies: [olderCopy] }
    const empty = await load(Response.json({ ...available, reconciliationCases: [] }))
    expect(empty).toContain('Inga avstämningsärenden.')
    const unavailable = await load(Response.json(available))
    expect(unavailable).toContain('Avstämningsärenden kunde inte läsas.')
    expect(unavailable).not.toContain('Inga avstämningsärenden.')
    expect(unavailable).toContain(`?attemptId=${olderAttemptId}`)
  })

  it('clears older protected data when the established read loses authorization', async () => {
    await load(Response.json({ status: 'available', copies: [olderCopy], reconciliationCases: [tracking] }))
    const html = await load(Response.json({ error: 'Välj ett behörigt bolag.' }, { status: 403 }))
    expect(html).toContain('Välj ett behörigt bolag.')
    expect(html).not.toMatch(/Inga avstämningsärenden|Hämta arkiverad MIME-fil/)
    expect(html).not.toContain(attemptId)
  })

  it('keeps the next message loading when the previous request completes', async () => {
    const finishPrevious = deferRead()
    const previous = loadButton(panel())!.onClick!()
    expect(loadButton(panel())?.disabled).toBe(true)

    const nextButton = loadButton(panel(otherMessageId))!
    const nextWasDisabled = nextButton.disabled
    const finishNext = deferRead()
    const next = nextButton.onClick!()
    finishPrevious(Response.json({ error: 'Välj ett behörigt bolag.' }, { status: 403 }))
    await previous
    const nextStillLoading = loadButton(panel(otherMessageId))?.disabled
    const nextLoading = renderToStaticMarkup(panel(otherMessageId))
    finishNext(Response.json({ status: 'available', copies: [olderCopy], reconciliationCases: [] }))
    await next

    expect(nextWasDisabled).toBe(false)
    expect(nextStillLoading).toBe(true)
    expect(nextLoading).not.toContain('Välj ett behörigt bolag.')
    expect(renderToStaticMarkup(panel(otherMessageId))).toContain(`?attemptId=${olderAttemptId}`)
  })

  it.each(['denied', 'held'])('preserves the next message result when the previous request returns %s late', async previousStatus => {
    const finishPrevious = deferRead()
    const previous = loadButton(panel())!.onClick!()

    io.fetch.mockResolvedValueOnce(Response.json({ status: 'available', copies: [olderCopy], reconciliationCases: [] }))
    await loadButton(panel(otherMessageId))!.onClick!()
    const nextEndpoint = `/api/ediel/messages/${otherMessageId}/transport-copy`
    const nextHref = `href="${nextEndpoint}?attemptId=${olderAttemptId}"`
    expect(io.fetch).toHaveBeenLastCalledWith(nextEndpoint, { cache: 'no-store', credentials: 'same-origin' })
    expect(renderToStaticMarkup(panel(otherMessageId))).toContain(nextHref)

    finishPrevious(previousStatus === 'denied' ? Response.json({ error: 'Välj ett behörigt bolag.' }, { status: 403 }) :
      Response.json({ status: 'held', copies: [], reconciliationCases: [tracking] }))
    await previous

    const html = renderToStaticMarkup(panel(otherMessageId))
    expect(html).not.toMatch(/Välj ett behörigt bolag|Ingen verifierad transportkopia/)
    expect(html).toContain(nextHref)
    expect(html).not.toContain(attemptId)
  })
})
