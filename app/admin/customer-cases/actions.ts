'use server'

function supportOutOfScope(): never {
  throw new Error('OPS hanterar inte supportflöden. Använd kundkortets arkiverings-, ånger- eller driftflöden i stället.')
}

export async function createCustomerCaseFromFormAction(): Promise<void> {
  supportOutOfScope()
}

export async function updateCustomerCaseStatusAction(): Promise<void> {
  supportOutOfScope()
}
