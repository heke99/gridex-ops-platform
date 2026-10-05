import {z} from 'zod'
import {REQUESTED_CHANGE_SOURCE_MAX_BYTES} from './requestedChangeIntake'
export {requestedChangeHttp as networkRegistrySourceHttp,requestedChangeHeaders as networkRegistrySourceHeaders,requestedChangeReview as networkRegistrySourceReview,artifactSelector,readRequestedChangeJson as readNetworkRegistryJson} from './requestedChangeHttp'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const networkRegistrySubmission=z.object({environment:z.enum(['test','production']),networkActorId:z.string().uuid(),validFrom:z.string().datetime({offset:true}),validUntil:z.string().datetime({offset:true}),source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4),mimeType:z.literal('application/pdf'),reference:text(2000),version:text(200)}).strict(),issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const networkRegistryWithdrawal=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),claimsHash:z.string().regex(/^[a-f0-9]{64}$/),reason:text(4000)}).strict()
export const NETWORK_REGISTRY_BODY_MAX_BYTES=Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4+128*1024
