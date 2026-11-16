import { getSupportAttachments, postSupportAttachment } from '@/lib/customer-service/supportApiHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = getSupportAttachments
export const POST = postSupportAttachment
