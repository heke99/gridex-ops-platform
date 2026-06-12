export const CUSTOMER_PORTAL_SCOPES = [
  'customer_portal.read',
  'customer_portal.write',
  'website_applications.write',
] as const

export const INTEGRATION_API_SCOPE_OPTIONS = [
  {
    value: 'customer_portal.read',
    label: 'Mina sidor · läsa kunddata',
    description: 'Avtal, fakturor, anläggningar, mätvärden och dokument för länkad kund.',
  },
  {
    value: 'customer_portal.write',
    label: 'Mina sidor · skriva kundmeddelanden',
    description: 'Kundlänkning, profiluppdatering, flytt och uppsägning.',
  },
  {
    value: 'website_applications.write',
    label: 'Hemsida · skapa kundansökan',
    description: 'Skapa eller matcha kund, kundnummer, portal identity, anläggning, mätpunkt och avtalsansökan från extern hemsida.',
  },
  {
    value: 'events.read',
    label: 'Events · läsa händelser',
    description: 'Systemhändelser för godkänd tenant och integration.',
  },
] as const

export type IntegrationApiScope = typeof INTEGRATION_API_SCOPE_OPTIONS[number]['value']

export const ALLOWED_INTEGRATION_API_SCOPE_VALUES = new Set<string>(
  INTEGRATION_API_SCOPE_OPTIONS.map((scope) => scope.value)
)
