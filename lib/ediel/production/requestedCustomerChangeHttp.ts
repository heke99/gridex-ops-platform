import {z} from 'zod'
import {REQUESTED_CUSTOMER_CHANGE_MAX_RAW_BYTES,REQUESTED_CUSTOMER_CHANGE_MAX_SOURCE_BYTES} from './requestedCustomerChangeSource'
export {requestedChangeHttp as requestedCustomerChangeHttp,requestedChangeHeaders as requestedCustomerChangeHeaders,requestedChangeReview as requestedCustomerChangeReview,artifactSelector,readRequestedChangeJson as readRequestedCustomerChangeJson} from './requestedChangeHttp'
export const REQUESTED_CUSTOMER_CHANGE_BODY_LIMIT=Math.ceil(REQUESTED_CUSTOMER_CHANGE_MAX_SOURCE_BYTES/3)*4+6*REQUESTED_CUSTOMER_CHANGE_MAX_RAW_BYTES+128*1024
const text=(max:number)=>z.string().trim().min(1).max(max)
// Environment/company/actor derive from the current server session/profile.
export const requestedCustomerChangeSubmission=z.object({agreementId:z.string().uuid(),supplyPeriodId:z.string().uuid(),contractId:z.string().uuid(),rawPayload:z.string().min(1).max(REQUESTED_CUSTOMER_CHANGE_MAX_RAW_BYTES),source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(REQUESTED_CUSTOMER_CHANGE_MAX_SOURCE_BYTES/3)*4),mimeType:z.literal('application/pdf'),reference:text(2000),version:text(200)}).strict(),issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const requestedCustomerChangeQueueCommand=z.object({preferredRouteId:z.string().uuid().nullable().optional()}).strict()
