import { seedDefaultCompanyEmailSettings } from './companyEmailSettings'
import { seedDefaultEmailEventRules } from './emailEvents'
import { seedDefaultEmailTemplates } from './emailTemplates'

export async function seedDefaultCompanyEmailConfiguration(companyId: string) {
  await seedDefaultCompanyEmailSettings(companyId)
  await seedDefaultEmailTemplates(companyId)
  await seedDefaultEmailEventRules(companyId)
}
