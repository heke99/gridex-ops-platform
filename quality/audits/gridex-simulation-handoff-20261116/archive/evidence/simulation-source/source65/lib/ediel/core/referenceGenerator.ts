import { buildEdielInterchangeReference, buildEdielTransactionReference } from './referenceRegistry'

export function generateEdielInterchangeReference(prefix = 'UNB'): string {
  return prefix === 'UNB' ? buildEdielInterchangeReference() : buildEdielTransactionReference({ family: 'EDIEL', code: prefix })
}

export function generateEdielMessageReference(prefix = 'MSG'): string {
  return buildEdielTransactionReference({ family: 'EDIEL', code: prefix })
}

export function generateEdielTransactionReference(prefix = 'TRX'): string {
  return buildEdielTransactionReference({ family: 'EDIEL', code: prefix })
}
