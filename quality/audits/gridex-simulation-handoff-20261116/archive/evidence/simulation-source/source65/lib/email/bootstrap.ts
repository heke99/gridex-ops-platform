import { seedDefaultCompanyEmailSettings } from './companyEmailSettings'
import { seedDefaultEmailEventRules } from './emailEvents'
import { seedDefaultEmailTemplates } from './emailTemplates'

export async function seedDefaultCompanyEmailConfiguration(companyId: string) {
  await seedDefaultCompanyEmailSettings(companyId)
  const templates = await seedDefaultEmailTemplates(companyId)
  const rules = await seedDefaultEmailEventRules(companyId)
  return { templates, rules }
}
