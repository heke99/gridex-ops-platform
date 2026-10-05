import {requestedChangeHttp,requestedChangeHeaders,readRequestedChangeJson} from './requestedChangeHttp'
import {SIGNED_BRP_ORIGINAL_MAX_BYTES} from './signedBrpDeclarationIntake'
export {signedBrpSelector,signedBrpSubmission,signedBrpReview} from './signedBrpDeclarationIntake'
export const signedBrpHttp=requestedChangeHttp
export const signedBrpHeaders=requestedChangeHeaders
export const readSignedBrpJson=readRequestedChangeJson
export const signedBrpArchiveBodyLimit=2*Math.ceil(SIGNED_BRP_ORIGINAL_MAX_BYTES/3)*4+256*1024
export const signedBrpReadPermissions=['communication.read','customers.read','contracts.read']
export const signedBrpWritePermissions=['communication.write','customers.write','contracts.write']
