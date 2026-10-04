/** Renderer fixtures require actual output bytes, including nullable DTO ports. */
export function edielDraftWire(draft:{rawPayload?:string|null}):string{
  if(typeof draft.rawPayload!=='string'||!draft.rawPayload)throw new Error('fixture_rendered_ediel_wire_required')
  return draft.rawPayload
}
