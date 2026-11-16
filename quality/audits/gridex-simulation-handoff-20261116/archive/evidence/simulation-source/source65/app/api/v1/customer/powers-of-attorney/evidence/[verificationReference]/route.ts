import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { customerPoaEvidenceDetail } from '@/lib/customer-portal/poaArchiveRoutes'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = withApiContractRepresentation('customer', customerPoaEvidenceDetail)
