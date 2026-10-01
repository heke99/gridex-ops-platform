import {z} from 'zod'
import {REQUESTED_CHANGE_SOURCE_MAX_BYTES} from './requestedChangeIntake'
export {requestedChangeHttp as bilateralSourceHttp,requestedChangeHeaders as bilateralSourceHeaders,requestedChangeReview as bilateralSourceReview,artifactSelector,readRequestedChangeJson as readBilateralSourceJson} from './requestedChangeHttp'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const bilateralSourceSubmission=z.object({sourceMessageId:z.string().uuid(),agreementId:z.string().uuid(),supplyPeriodId:z.string().uuid(),contractId:z.string().uuid(),source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4),mimeType:z.literal('application/pdf'),reference:text(2000),version:text(200)}).strict(),issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const bilateralApplyCommand=z.object({}).strict()
