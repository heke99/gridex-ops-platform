import 'server-only'

export const WEBHOOK_MANAGE_REQUIREMENT = { anyOf: ['integrations.write'] }
export const WEBHOOK_TEST_QUEUED = 'Testevent skapades och köades för webhook.'
export const WEBHOOK_RESEND_QUEUED = 'Webhook delivery köades om.'
export const WEBHOOK_IGNORED = 'Webhook delivery markerades som hanterad.'
export const WEBHOOK_COMMAND_UNAVAILABLE =
  'Åtgärden kunde inte utföras. Kontrollera leveransens status eller att anslutningen fortfarande är aktiv.'
