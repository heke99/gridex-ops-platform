import { GRIDEX_TENANT_BUSINESS_ACTIONS, gridexBusinessMessageLabel, gridexBlockerLabel } from '@/lib/ediel/businessLabels'

export type GridexBusinessProcessKey =
  | 'grid_owner_information_request'
  | 'supplier_switch'
  | 'supplier_switch_cancellation'
  | 'customer_move_out'
  | 'end_supply'
  | 'disconnection_case'
  | 'metering_values_ingestion'
  | 'monthly_billing_underlay'
  | 'billing_partner_export'

export type GridexBusinessProcessAudience = 'tenant' | 'superadmin'

export type GridexBusinessProcessDefinition = {
  key: GridexBusinessProcessKey
  tenantLabel: string
  tenantDescription: string
  technicalFamily: string | null
  technicalCode: string | null
  expectedInbound: string[]
  tenantStatuses: {
    notStarted: string
    running: string
    waiting: string
    completed: string
    blocked: string
  }
  superadminNotes: string[]
  isTenantManualAction: boolean
  isBackgroundAutomation: boolean
}

export const GRIDEX_BUSINESS_PROCESSES: Record<GridexBusinessProcessKey, GridexBusinessProcessDefinition> = {
  grid_owner_information_request: {
    key: 'grid_owner_information_request',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.requestGridOwnerInformation,
    tenantDescription: 'Systemet begär uppgifter från nätägaren och väntar på svar innan nästa steg.',
    technicalFamily: 'PRODAT',
    technicalCode: 'Z01',
    expectedInbound: ['PRODAT Z02', 'negativ APERAK', 'negativ CONTRL'],
    tenantStatuses: {
      notStarted: 'Uppgifter har inte begärts ännu',
      running: 'Uppgiftsbegäran förbereds',
      waiting: 'Väntar på svar från nätägaren',
      completed: 'Uppgifter mottagna',
      blocked: 'Uppgiftsbegäran kräver åtgärd',
    },
    superadminNotes: ['Outbound PRODAT Z01 L/LK', 'Svar ska korreleras till Z02 L/LK eller negativ APERAK', 'Manual fallback får bara vara reservväg'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  supplier_switch: {
    key: 'supplier_switch',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.startSupplierSwitch,
    tenantDescription: 'Systemet startar leverantörsbytet från valt datum när kund, fullmakt, anläggning och route är redo.',
    technicalFamily: 'PRODAT',
    technicalCode: 'Z03',
    expectedInbound: ['PRODAT Z04', 'negativ APERAK', 'negativ CONTRL'],
    tenantStatuses: {
      notStarted: 'Leverantörsbyte har inte startats',
      running: 'Leverantörsbyte förbereds',
      waiting: 'Väntar på svar från nätägaren',
      completed: 'Leverantörsbyte bekräftat',
      blocked: 'Leverantörsbyte kräver åtgärd',
    },
    superadminNotes: ['Outbound PRODAT Z03 L/LK', 'Inbound Z04 uppdaterar switchstatus', 'Startdatum ska valideras mot regelverk och kunddata'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  supplier_switch_cancellation: {
    key: 'supplier_switch_cancellation',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.customerWithdrawal,
    tenantDescription: 'Systemet hanterar kundens ånger eller återkallelse om tidsfrister och status tillåter det.',
    technicalFamily: 'PRODAT',
    technicalCode: 'Z03C',
    expectedInbound: ['positiv APERAK', 'negativ APERAK', 'negativ CONTRL'],
    tenantStatuses: {
      notStarted: 'Ingen återkallelse registrerad',
      running: 'Återkallelse förbereds',
      waiting: 'Väntar på bekräftelse',
      completed: 'Återkallelse bekräftad',
      blocked: 'Återkallelse kräver åtgärd',
    },
    superadminNotes: ['PRODAT cancellation/subtype ska väljas av processregeln', 'Får inte skickas om leveransstart passerat utan manuell kontroll'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  customer_move_out: {
    key: 'customer_move_out',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.customerMoveOut,
    tenantDescription: 'Systemet hanterar att kunden flyttar från bolaget och visar om avslut kan automatiseras.',
    technicalFamily: 'PRODAT',
    technicalCode: 'Z05',
    expectedInbound: ['PRODAT Z05', 'negativ APERAK', 'negativ CONTRL'],
    tenantStatuses: {
      notStarted: 'Flytt är inte registrerad',
      running: 'Flytt hanteras',
      waiting: 'Väntar på nätägare',
      completed: 'Leverans avslutad',
      blocked: 'Flytt kräver åtgärd',
    },
    superadminNotes: ['Flytt/leveransförändring ska processas via regelmotor', 'Z05 ska inte missbrukas som fri tenant-knapp'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  end_supply: {
    key: 'end_supply',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.endSupply,
    tenantDescription: 'Systemet avslutar leverans när processen tillåter det och skapar annars en arbetsköpost.',
    technicalFamily: 'PRODAT',
    technicalCode: 'Z09',
    expectedInbound: ['PRODAT Z10', 'negativ APERAK', 'negativ CONTRL'],
    tenantStatuses: {
      notStarted: 'Avslut är inte påbörjat',
      running: 'Avslut förbereds',
      waiting: 'Väntar på bekräftelse',
      completed: 'Leverans avslutad',
      blocked: 'Avslut kräver åtgärd',
    },
    superadminNotes: ['Z09/Z10 används bara där processregeln tillåter det', 'Osäkra avslut ska gå till arbetskö'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  disconnection_case: {
    key: 'disconnection_case',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.disconnectionCase,
    tenantDescription: 'Systemet skapar ett granskningsbart underlag. Frånkoppling skickas inte automatiskt utan regelkontroll.',
    technicalFamily: null,
    technicalCode: null,
    expectedInbound: [],
    tenantStatuses: {
      notStarted: 'Inget underlag skapat',
      running: 'Underlag skapas',
      waiting: 'Väntar på manuell åtgärd',
      completed: 'Underlag klart',
      blocked: 'Underlag kräver åtgärd',
    },
    superadminNotes: ['Automatisk frånkoppling får inte ske utan uttrycklig regel och manuell kontroll', 'Logga orsak, datum, ansvarig och underlag'],
    isTenantManualAction: true,
    isBackgroundAutomation: false,
  },
  metering_values_ingestion: {
    key: 'metering_values_ingestion',
    tenantLabel: 'Mätvärden mottagna',
    tenantDescription: 'Systemet tar emot mätvärden från nätägare och matchar dem mot kundens leveransperiod.',
    technicalFamily: 'UTILTS',
    technicalCode: 'E66',
    expectedInbound: ['UTILTS E66', 'UTILTS_ERR'],
    tenantStatuses: {
      notStarted: 'Väntar på mätvärden',
      running: 'Mätvärden behandlas',
      waiting: 'Väntar på mätvärden',
      completed: 'Mätvärden mottagna',
      blocked: 'Mätvärden kräver åtgärd',
    },
    superadminNotes: ['Inbound UTILTS E66 ska spara metering_values', 'Felaktig UTILTS ska hanteras med UTILTS_ERR när regelverket kräver det'],
    isTenantManualAction: false,
    isBackgroundAutomation: true,
  },
  monthly_billing_underlay: {
    key: 'monthly_billing_underlay',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.billingAutomatic,
    tenantDescription: 'Systemet skapar fakturaunderlag automatiskt när perioden är komplett.',
    technicalFamily: null,
    technicalCode: null,
    expectedInbound: [],
    tenantStatuses: {
      notStarted: 'Fakturaunderlag skapas automatiskt vid månadsslut',
      running: 'Fakturaunderlag skapas',
      waiting: 'Väntar på mätvärden',
      completed: 'Underlag klart',
      blocked: 'Fakturering kräver åtgärd',
    },
    superadminNotes: ['Månadskörning ska vara idempotent', 'Saknade mätvärden eller prissnapshot ska skapa blockerare'],
    isTenantManualAction: false,
    isBackgroundAutomation: true,
  },
  billing_partner_export: {
    key: 'billing_partner_export',
    tenantLabel: GRIDEX_TENANT_BUSINESS_ACTIONS.billingSentToPartner,
    tenantDescription: 'Systemet skickar färdigt fakturaunderlag till fakturapartner när underlaget är komplett.',
    technicalFamily: null,
    technicalCode: null,
    expectedInbound: [],
    tenantStatuses: {
      notStarted: 'Underlag har inte skickats ännu',
      running: 'Underlag skickas till fakturapartner',
      waiting: 'Väntar på fakturapartner',
      completed: 'Underlag skickat till fakturapartner',
      blocked: 'Fakturapartner kräver åtgärd',
    },
    superadminNotes: ['Export ska ha idempotency key', 'Exporterade underlag ska låsas', 'Provider-svar ska loggas'],
    isTenantManualAction: false,
    isBackgroundAutomation: true,
  },
}

export function getGridexBusinessProcess(key: GridexBusinessProcessKey) {
  return GRIDEX_BUSINESS_PROCESSES[key]
}

export function businessProcessTechnicalLabel(key: GridexBusinessProcessKey, audience: GridexBusinessProcessAudience = 'tenant') {
  const process = getGridexBusinessProcess(key)
  if (audience === 'tenant') return process.tenantLabel
  return process.technicalFamily && process.technicalCode
    ? gridexBusinessMessageLabel({ family: process.technicalFamily, code: process.technicalCode }, 'superadmin')
    : process.tenantLabel
}

export function businessProcessBlockedLabel(code: string | null | undefined, audience: GridexBusinessProcessAudience = 'tenant') {
  return gridexBlockerLabel(code, audience)
}
