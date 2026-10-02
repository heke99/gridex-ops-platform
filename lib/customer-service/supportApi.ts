import { ApiInputError } from '@/lib/api/strictRequest'
import { SupportConversationError } from '@/lib/customer-service/supportConversation'
import { SupportAttachmentError } from '@/lib/customer-service/supportAttachments'

/** Maps support domain errors onto the public API error model. */
export function toSupportApiError(error: unknown): unknown {
  if (error instanceof SupportConversationError || error instanceof SupportAttachmentError) {
    return new ApiInputError(error.message, error.code, error.status)
  }
  return error
}

