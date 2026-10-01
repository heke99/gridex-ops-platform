import {z} from 'zod'
import {BILATERAL_PRODAT_SOURCE_MAX_BYTES} from './bilateralProdatProfileIntake'
// Reuse the actual bounded UTF-8/body reader and authenticated server-selected
// company/actor guard. Its implementation and error responses carry no authority.
export {requestedChangeHttp as bilateralProdatHttp,requestedChangeHeaders as bilateralProdatHeaders,readRequestedChangeJson as readBilateralProdatJson} from './requestedChangeHttp'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const bilateralProdatSelector=z.object({environment:z.enum(['test','production']),kind:z.enum(['normal_start_h','own_end_h','closure_request_lk']),rulePackId:z.string().uuid(),bilateralAgreementId:z.string().uuid(),gridAreaCode:text(35),validFrom:z.string().datetime({offset:true}),validTo:z.string().datetime({offset:true})}).strict()
export const bilateralProdatSubmission=bilateralProdatSelector.extend({source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(BILATERAL_PRODAT_SOURCE_MAX_BYTES/3)*4),
 mimeType:z.enum(['application/pdf','text/plain','application/json']),reference:text(2000),version:text(200)}).strict(),
 issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const bilateralProdatReview=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),scopeHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','hold','reject']),reason:text(4000)}).strict()
export const bilateralProdatArtifactId=z.string().uuid()
