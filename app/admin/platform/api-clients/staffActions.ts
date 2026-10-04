'use server'

import { revalidatePath } from 'next/cache'
import { createDedicatedStaffIntegrationClient, StaffClientCreationInputError } from '@/lib/integrations/staffClientCreation'

export type CreateStaffApiClientState = {
  ok: boolean
  message: string
  token?: string
  keyPrefix?: string
  clientId?: string
}

export async function createStaffIntegrationApiClientAction(
  _previousState: CreateStaffApiClientState,
  formData: FormData,
): Promise<CreateStaffApiClientState> {
  try {
    const company = formData.get('companyId')
    const name = formData.get('name')
    const credential = await createDedicatedStaffIntegrationClient({
      companyId: typeof company === 'string' ? company : '',
      name: typeof name === 'string' ? name : '',
    })
    revalidatePath('/admin/platform/api-clients')
    return { ok: true, message: 'Separat staff-klient skapad. Spara nyckeln nu; den visas bara här.', ...credential }
  } catch (error) {
    return { ok: false, message: error instanceof StaffClientCreationInputError
      ? error.message : 'Staff-klienten kunde inte skapas. Kontrollera behörighet och systemstatus och försök igen.' }
  }
}
