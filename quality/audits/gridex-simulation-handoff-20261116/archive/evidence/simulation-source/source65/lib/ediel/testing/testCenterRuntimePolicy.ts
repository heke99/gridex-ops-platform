export type TestCenterRuntimeMessageIdentity = {
  id: string
  company_id?: string | null
  customer_id?: string | null
  message_family?: string | null
  direction?: string | null
  environment?: string | null
}

export function assertTestCenterRuntimeMessage(input: {
  message: TestCenterRuntimeMessageIdentity
  companyId: string
  customerId: string
}): void {
  if (input.message.environment !== 'test') {
    throw new Error('Test Center runtime får endast behandla Ediel-meddelanden i testmiljö.')
  }
  if (input.message.direction !== 'inbound') {
    throw new Error('Test Center runtime kräver ett inkommande Ediel-meddelande.')
  }
  if (input.message.message_family !== 'UTILTS') {
    throw new Error('Test Center runtime accepterar endast UTILTS för mätvärde-till-faktura-kedjan.')
  }
  if (input.message.company_id !== input.companyId) {
    throw new Error('Test Center runtime stoppades: Ediel-meddelandet tillhör inte valt bolag.')
  }
  if (!input.message.customer_id || input.message.customer_id !== input.customerId) {
    throw new Error('Test Center runtime stoppades: Ediel-meddelandet måste vara explicit kopplat till vald testkund före mätvärdesingest.')
  }
}

export function normalizeTestCenterBillingMonth(value: string): string {
  const billingMonth = value.trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
    throw new Error('Test Center fakturamånad måste anges som YYYY-MM.')
  }
  return billingMonth
}
