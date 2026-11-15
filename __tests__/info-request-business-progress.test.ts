import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import InfoRequestProcessDetails from '@/components/admin/customers/InfoRequestProcessDetails'
import type { EdielProcessNextAction } from '@/lib/ediel/operations/processNextAction'
const decision: EdielProcessNextAction = {
  version: 1, sourceMessageId: 'RAW-SOURCE-ID', cause: 'business_response_pending', responsibility: 'counterparty', waitingFor: ['Z02_or_negative_APERAK','CONTRL'], blockers: [], allowedActions: ['read_source'], summary: 'RAW-PRODAT-SUMMARY',
  timeBasis: { anchor: 'actual_accepted_smtp_observed_at', anchorAt: '2026-11-15T09:00:00Z', businessDueAt: '2026-11-16T09:00:00Z', technicalDueAt: null, remoteReceiptKnown: false, timerKind: 'internal_sender_watch' }, authorizesProviderEntry: false, automaticResendAllowed: false,
}
it.each(['source_context_held','business_response_pending','business_response_received','business_response_rejected','business_watch_overdue','technical_rejection'] as const)('explains %s without protocol and timing implementation details', cause => {
  const html = renderToStaticMarkup(React.createElement(InfoRequestProcessDetails, { decision: { ...decision, cause } }))
  expect(html).toContain('Nästa steg')
  expect(html).toContain('Följ upp senast')
  for (const marker of ['PRODAT','RAW-','SMTP','APERAK','CONTRL','Källbeslut','Teknisk bevakning']) expect(html).not.toContain(marker)
})
it('keeps original process evidence available to the platform view', () => {
  const html = renderToStaticMarkup(React.createElement(InfoRequestProcessDetails, { decision, showTechnicalDetails: true }))
  expect(html).toContain('RAW-PRODAT-SUMMARY')
  expect(html).toContain('SMTP')
  expect(html).toContain('CONTRL')
})
