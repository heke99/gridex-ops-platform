// simulation: 20261029-3f1a8ab1/claude-track2/014
export const INTERNAL_PUBLICATION_REPUBLISH_REQUIRED_MESSAGE =
  'Avtalsmallen har ändrats sedan den publicerades i den interna kanalen. Publicera om den interna kanalen innan avtal skapas.'

type RpcErrorLike = { code?: string | null; message?: string | null }

// Maps the controlled domain error from gridex_ensure_internal_contract_publication
// to a Swedish message; every other RPC error is returned unchanged.
export function toInternalContractCreateError(error: RpcErrorLike): Error | RpcErrorLike {
  if (error.code === 'P0001' && error.message === 'internal_publication_republish_required') {
    return new Error(INTERNAL_PUBLICATION_REPUBLISH_REQUIRED_MESSAGE)
  }
  return error
}
