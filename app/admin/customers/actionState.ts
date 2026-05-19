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
  | 'optionalFeeLines'

export type IntakeFieldErrors = Partial<Record<IntakeField, string>>

export type IntakeActionState = {
  status: 'idle' | 'success' | 'error'
  message: string | null
  fieldErrors: IntakeFieldErrors
  createdCustomerId: string | null
}

export const initialIntakeActionState: IntakeActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  createdCustomerId: null,
}
export type CustomerImportPreviewRow = {
  rowNumber: number
  label: string
  uniqueKey: string
  warnings: string[]
  payload: Record<string, string>
}

export type CustomerImportActionState = {
  status: 'idle' | 'success' | 'error'
  message: string | null
  totalRows: number
  createdRows: number
  failedRows: number
  warnings: string[]
  rows: CustomerImportPreviewRow[]
}

export const initialCustomerImportActionState: CustomerImportActionState = {
  status: 'idle',
  message: null,
  totalRows: 0,
  createdRows: 0,
  failedRows: 0,
  warnings: [],
  rows: [],
}
