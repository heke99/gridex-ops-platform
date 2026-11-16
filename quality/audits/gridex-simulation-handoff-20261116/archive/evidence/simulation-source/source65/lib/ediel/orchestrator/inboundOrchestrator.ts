import { getEdielMessageById } from '@/lib/ediel/db'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { analyzeEdielProcessingPipeline, type EdielProcessingPipelineResult } from '@/lib/ediel/orchestrator/edielProcessingPipeline'
import type { EdielMessageRow } from '@/lib/ediel/types'

export async function inspectInboundEdielAutomation(params: {
  actorUserId: string
  edielMessageId: string
}): Promise<EdielProcessingPipelineResult> {
  const message = await getEdielMessageById(params.edielMessageId)
  if (!message) throw new Error('Ediel message not found for inbound automation inspection.')
  return analyzeEdielProcessingPipeline({ actorUserId: params.actorUserId, message })
}

export async function runInboundEdielOrchestrator(params: {
  actorUserId: string
  edielMessageId: string
  processExistingFlow?: boolean
}): Promise<{ message: EdielMessageRow; pipeline: EdielProcessingPipelineResult }> {
  const processed = params.processExistingFlow === false
    ? await getEdielMessageById(params.edielMessageId)
    : await processInboundEdielMessage({ actorUserId: params.actorUserId, edielMessageId: params.edielMessageId })

  if (!processed) throw new Error('Ediel message not found after inbound orchestration.')

  const latest = await getEdielMessageById(processed.id)
  if (!latest) throw new Error('Ediel message not found after inbound orchestration reload.')

  const pipeline = await analyzeEdielProcessingPipeline({ actorUserId: params.actorUserId, message: latest })
  return { message: latest, pipeline }
}
