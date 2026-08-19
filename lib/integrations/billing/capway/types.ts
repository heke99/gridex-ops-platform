export type CapwayEnvironment = 'test' | 'production'

export type CapwayFinancingMode =
  | 'invoice_service'
  | 'factoring_without_recourse'
  | 'factoring_with_recourse'
  | 'manual'

export type CapwayAuthMode = 'oauth2' | 'apikey'

export type CapwayConnectionConfig = {
  companyId: string
  environment: CapwayEnvironment
  provider: 'capway_aptic'
  baseUrl: string
  authMode: CapwayAuthMode
  tokenUrl?: string | null
  clientId?: string | null
  clientSecret?: string | null
  apiKey?: string | null
  apiKeyHeader?: string | null
  defaultService: string
  defaultPaymentCode?: string | null
  defaultPrintCode?: string | null
  defaultFormCode?: string | null
  defaultPaymentProductCode?: string | null
  defaultPreferredChannel?: string | null
  defaultFinancingMode: CapwayFinancingMode
  rawSettings?: Record<string, unknown>
}

export type CapwayTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
  scope?: string
}

export type CapwayInvoiceDebtRow = {
  rowReference?: string | null
  itemReference?: string | null
  description?: string | null
  itemCount?: number | null
  unitTypeId?: number | null
  itemNetAmount?: number | null
  rowPrincipalAmount?: number | null
  includingVAT: boolean
  vatAmount?: number | null
  vatCode?: string | null
  accountChartCode?: string | null
  extraFields?: Array<{ name: string; value: string[] }>
}

export type CapwayInvoiceDebt = {
  debtPrincipalType?: number
  description?: string | null
  invoiceNumber?: string | null
  originalReferenceNumber?: string | null
  paymentReference?: string | null
  ledgerReference?: string | null
  originalPrincipal: number
  remainingPrincipal: number
  originalVat: number
  remainingVat: number
  rounding?: number | null
  currencyCode: string
  invoiceDate: string
  dueDate?: string | null
  paymentCondition?: number | null
  message?: string | null
  receiverFullName?: string | null
  receiverStreet?: string | null
  receiverCity?: string | null
  receiverZipCode?: string | null
  receiverCountryCode?: string | null
  debtRows?: CapwayInvoiceDebtRow[]
  extraFields?: Array<{ name: string; value: string[] }>
}

export type CapwayInvoiceCustomer = {
  customerReference?: string | null
  idNumber?: string | null
  juridicalType?: 0 | 1 | null
  customerRole?: number | null
  firstname?: string | null
  lastname?: string | null
  fullAddress?: string | null
  street?: string | null
  city?: string | null
  zipCode?: string | null
  countryCode?: string | null
  vatNumber?: string | null
  homePhone?: string | null
  cellularPhone?: string | null
  email?: string | null
  languageCode?: string | null
  currencyCode?: string | null
  preferredchannel?: string | null
  invoiceChannel?: string | null
  extraFields?: Array<{ name: string; value: string[] }>
}

export type CapwayPutInvoice = {
  creditorReference?: string | null
  referenceNumber?: string | null
  deliverySystemCode?: string | null
  paymentReference?: string | null
  service?: string | null
  tryComplementExisting?: boolean | null
  claimantName?: string | null
  purchasable?: 0 | 1 | 2
  purchaseFee?: string | null
  invoiceDate?: string | null
  paymentCode?: string | null
  printCode?: string | null
  formCode?: string | null
  receiverReference?: string | null
  preferredChannel?: string | null
  externalReferenceCode?: string | null
  paymentProductCode?: string | null
  customer: CapwayInvoiceCustomer
  debts: CapwayInvoiceDebt[]
  fees?: unknown[]
  extraFields?: Array<{ name: string; unique?: boolean; value: string[] }>
  note?: Array<{ noteText: string; systemCode?: string; important?: boolean }>
  document?: Array<{
    note?: string | null
    documentType?: string | null
    loggedAt?: string | null
    originalFileName?: string | null
    searchValue?: string | null
    externalLink?: string | null
    important?: boolean | null
    fileDataBase64?: string | null
  }>
}

export type CapwayPutInvoiceResult = {
  invoiceGuids?: string[] | null
  impStockId?: number | null
  reconciled?: boolean
  [key: string]: unknown
}

export type CapwayInvoiceListResult = {
  count?: number | null
  skip?: number | null
  total?: number | null
  value?: Array<{
    invoiceGuid?: string | null
    invoiceNumber?: string | null
    clientReferenceNumber?: string | null
    customerNumber?: string | null
    [key: string]: unknown
  }> | null
}

export type CapwayPurchaseRequest = {
  purchaseFeeAmount?: number | null
  purchaseFeeCurrency?: string | null
  purchaseFeePercentage?: number | null
  invoiceItemId?: number | null
  approved?: boolean | null
  recourseDays?: number | null
  depositAmount?: number | null
  note?: string | null
}
