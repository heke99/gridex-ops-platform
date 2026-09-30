import { supabaseService } from '@/lib/supabase/service'
import type { EdielServiceAssessment } from './types'

/** The server reads scoped evidence and current actor facts. UI booleans are never authority. */
export async function assessEdielServiceAssignment(input: {
  providerCompanyId: string; assignmentId: string
}): Promise<EdielServiceAssessment> {
  const { data, error } = await supabaseService.rpc('ediel_service_assignment_assessment_v1', {
    p_provider_company_id: input.providerCompanyId, p_assignment_id: input.assignmentId,
  })
  if (error) throw error
  if (!data || !['held', 'authorized'].includes(data.status)) throw new Error('ediel_service_assessment_invalid')
  return data as EdielServiceAssessment
}
