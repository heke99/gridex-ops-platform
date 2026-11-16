import {z} from 'zod'
import {REGULATED_SUPPLY_SOURCE_MAX_BYTES} from './regulatedSupplyGroundIntake'
// Reuse the actual bounded UTF-8/body reader and authenticated server-selected
// company/actor guard. Its implementation and error responses carry no authority.
export {requestedChangeHttp as regulatedSupplyHttp,requestedChangeHeaders as regulatedSupplyHeaders,readRequestedChangeJson as readRegulatedSupplyJson} from './requestedChangeHttp'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const regulatedSupplySelector=z.object({environment:z.enum(['test','production']),kind:z.enum(['assigned_supply','production_receipt_obligation']),
 contractId:z.string().uuid(),meteringPointId:z.string().uuid(),identityAgency:z.enum(['9','89']),bilateralAgreementId:z.string().uuid(),startAt:z.string().datetime({offset:true}),consumptionSupplyPeriodId:z.string().uuid().nullable().optional()}).strict()
export const regulatedSupplySubmission=regulatedSupplySelector.extend({source:z.object({bytesBase64:z.string().min(4).max(Math.ceil(REGULATED_SUPPLY_SOURCE_MAX_BYTES/3)*4),
 mimeType:z.enum(['application/pdf','text/plain','application/json']),reference:text(2000),version:text(200)}).strict(),
 issuerReceipt:z.object({keyId:z.string().uuid(),representationId:z.string().uuid(),payloadBase64:text(65536),signatureHex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()
export const regulatedSupplyReview=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),scopeHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','hold','reject']),reason:text(4000)}).strict()
export const regulatedArtifactId=z.string().uuid()
