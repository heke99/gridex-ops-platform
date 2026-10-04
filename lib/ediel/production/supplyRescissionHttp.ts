import {z} from 'zod'
import {SUPPLY_RESCISSION_SOURCE_MAX_BYTES} from './supplyRescissionIntake'
export{requestedChangeHttp as supplyRescissionHttp,requestedChangeHeaders as supplyRescissionHeaders,readRequestedChangeJson as readSupplyRescissionJson}from './requestedChangeHttp'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const supplyRescissionSelector=z.object({environment:z.enum(['test','production']),supplyPeriodId:z.string().uuid(),effectiveAt:z.string().datetime({offset:true}).refine(v=>Date.parse(v)%60000===0),rulePackId:z.string().uuid()}).strict()
export const supplyRescissionSubmission=supplyRescissionSelector.extend({source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(SUPPLY_RESCISSION_SOURCE_MAX_BYTES/3)*4),mimeType:z.enum(['application/pdf','text/plain']),reference:text(2000),version:text(200)}).strict(),issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(Math.ceil(65536/3)*4),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const supplyRescissionReview=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),scopeHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','hold','reject']),reason:text(2000),sourceClauseLocator:text(2000).optional(),sourceClauseQuote:text(2000).optional()}).strict().refine(v=>v.decision!=='approve'||!!v.sourceClauseLocator&&!!v.sourceClauseQuote)
export const supplyRescissionArtifactId=z.string().uuid()
