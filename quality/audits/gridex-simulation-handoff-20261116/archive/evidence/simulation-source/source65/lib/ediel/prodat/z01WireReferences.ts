import {buildEdielInterchangeReference,buildEdielTransactionReference} from '@/lib/ediel/core/referenceRegistry'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'

export type Z01WireReferences=Readonly<{documentReference:string;transactionReference:string;interchangeReference:string;messageReference:string}>

function exactApplicationReference(value:string|null|undefined,kind:'document'|'transaction'):string {
 if(typeof value!=='string'||!value||value!==value.trim()||value.length>35||/[\x00-\x1f\x7f]/.test(value))throw new Error(`z01_${kind}_reference_invalid`)
 return value
}

/** Allocate once before the intent. The canonical allocator retains full own
 * reference entropy; selected original document/LI identities are never cut. */
export function allocateZ01WireReferences(selected:{documentReference?:string|null;transactionReference?:string|null}={}):Z01WireReferences {
 return Object.freeze({documentReference:exactApplicationReference(selected.documentReference??buildEdielTransactionReference({family:'PRODAT',code:'Z01'}),'document'),
 transactionReference:exactApplicationReference(selected.transactionReference??buildEdielTransactionReference({family:'PRODAT',code:'LI'}),'transaction'),
 interchangeReference:buildEdielInterchangeReference(),messageReference:'1'})
}

/** Rendering consumes the actual persisted validated intent, including after
 * idempotent reuse. It may never replace its interchange/message identities. */
export function z01WireReferencesFromIntent(intent:EdielMessageIntent):Z01WireReferences {
 if(intent.messageFamily!=='PRODAT'||intent.messageCode!=='Z01'||intent.validationStatus!=='validated'
  ||typeof intent.interchangeReference!=='string'||!intent.interchangeReference||intent.interchangeReference!==intent.interchangeReference.trim()||intent.interchangeReference.length>14
  ||typeof intent.messageReference!=='string'||!intent.messageReference||intent.messageReference!==intent.messageReference.trim()||intent.messageReference.length>14
  ||/[\x00-\x1f\x7f]/.test(intent.interchangeReference+intent.messageReference))throw new Error('z01_validated_intent_wire_references_required')
 return Object.freeze({documentReference:exactApplicationReference(typeof intent.payload.documentReference==='string'?intent.payload.documentReference:null,'document'),
 transactionReference:exactApplicationReference(intent.transactionReference,'transaction'),interchangeReference:intent.interchangeReference,messageReference:intent.messageReference})
}
