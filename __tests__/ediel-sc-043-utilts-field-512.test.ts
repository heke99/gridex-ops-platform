// masterplan: SC-043
// A UTILTS without its mandatory registration time (field 512, SG5 DTM+597)
// gets ERC 41 naming field 512 in UTILTS' FTX format, never the DTM qualifier.
import {expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

it('missing field 512 is reported as ERC 41 / FTX 512, not 597',()=>{
 const source=energyHandoffMessage('2026-10-01')
 const raw_payload=recountEdifactUnt(source.raw_payload!.replace("DTM+597:202607010020:203'\n",''))
 const errors=runUtiltsRuntimeForMessage({...source,raw_payload},{referenceDate:'2026-10-01'}).ackPlan.aperakApplicationErrors
 expect(errors).toEqual([expect.objectContaining({ercCode:'41',fieldCode:'512',referenceNumber:'GRIDEX2607E66001'})])
 const reply=String(buildAperakDraft({sourceMessage:{...source,raw_payload},outcome:'negative',applicationErrors:errors}).rawPayload)
 expect(reply).toContain("ERC+41::260'");expect(reply).toContain("FTX+AAO++512::260+MANDATORY FIELD MISSING'")
 expect(reply).not.toMatch(/FTX\+AAO\+\+597/)
})
