export type IntakeField =
  | 'customerType'
  | 'intakeFlowType'
  | 'firstName'
  | 'lastName'
  | 'companyName'
  | 'contactTitle'
  | 'email'
  | 'phone'
  | 'personalNumber'
  | 'orgNumber'
  | 'apartmentNumber'
  | 'siteName'
  | 'facilityId'
  | 'meterPointId'
  | 'siteType'
  | 'gridOwnerId'
  | 'priceAreaCode'
  | 'moveInDate'
  | 'annualConsumptionKwh'
  | 'currentSupplierName'
  | 'currentSupplierOrgNumber'
  | 'street'
  | 'postalCode'
  | 'city'
  | 'careOf'
  | 'country'
  | 'movedFromStreet'
  | 'movedFromPostalCode'
  | 'movedFromCity'
  | 'movedFromSupplierName'
  | 'contractOfferId'
  | 'contractStartDate'
  | 'contractStatus'
  | 'overrideReason'
  | 'contractTypeOverride'
  | 'fixedPriceOrePerKwh'
  | 'spotMarkupOrePerKwh'
  | 'variableFeeOrePerKwh'
  | 'monthlyFeeSek'
  | 'greenFeeMode'
  | 'greenFeeValue'
  | 'bindingMonths'
  | 'noticeMonths'
  | 'gridAreaCode'
  | 'customerConfirmationStatus'
  | 'authorizationStatus'
  | 'authorizationValidFrom'
  | 'authorizationValidTo'
  | 'expectedStartDate'
  | 'confirmedStartDate'
  | 'actualStartDate'
  | 'startDateSource'
  | 'optionalFeeLines'
  | 'consolidatedInvoice'
  | 'billingLevel'
  | 'billingAddressSameAsSite'
  | 'billingCountry'
  | 'billingCity'
  | 'billingPostalCode'
  | 'billingStreet'
  | 'invoiceReference'
  | 'invoiceEmail'
  | 'invoiceRecipient'
  | 'duplicateOverrideReason'
  | 'existingCustomerId'
  | 'duplicateResolution'

export type IntakeFieldErrors = Partial<Record<IntakeField, string>>

export type IntakeFormValues = Partial<Record<IntakeField, string>>

export type IntakeActionState = {
  status: 'idle' | 'success' | 'error'
  message: string | null
  fieldErrors: IntakeFieldErrors
  values: IntakeFormValues
  createdCustomerId: string | null
  duplicateWarnings?: string[]
  duplicateReviewRequired?: boolean
}

export const initialIntakeActionState: IntakeActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  values: { country: 'SE' },
  createdCustomerId: null,
  duplicateWarnings: [],
  duplicateReviewRequired: false,
}
export type CustomerImportPreviewRowStatus =
  | 'ready_to_create'
  | 'requires_review'
  | 'duplicate_warning'
  | 'missing_fields'
  | 'created'
  | 'rejected'
  | 'failed'

export type CustomerImportPreviewRow = {
  rowNumber: number
  label: string
  uniqueKey: string
  status: CustomerImportPreviewRowStatus
  confidence: number
  warnings: string[]
  missingFields: string[]
  uncertainFields: string[]
  duplicateWarnings: string[]
  payload: Record<string, string>
}

export type CustomerImportActionState = {
  status: 'idle' | 'success' | 'error'
  message: string | null
  totalRows: number
  createdRows: number
  failedRows: number
  reviewRows: number
  warnings: string[]
  rows: CustomerImportPreviewRow[]
}

export const initialCustomerImportActionState: CustomerImportActionState = {
  status: 'idle',
  message: null,
  totalRows: 0,
  createdRows: 0,
  failedRows: 0,
  reviewRows: 0,
  warnings: [],
  rows: [],
}
