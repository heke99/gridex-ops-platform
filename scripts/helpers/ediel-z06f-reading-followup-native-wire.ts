// Physical synthetic source input only; these bytes do not qualify any source,
// current legal role, applied structural state, accepted reading or data grant.
import {randomUUID} from 'node:crypto'
import {structuralOwnerSource} from '../../__tests__/helpers/structuralOwnerFixtures'
import {priorE30PointWire} from '../../__tests__/helpers/priorUtiltsStructureFixtures'
export type Z06fNativeWireScope={external:string;sender:string;receiver:string;brpEdielId:string;caseReference:string;gridAreaCode:string;requestedStartDate:string}
/** The Z06 F/G change instant (DTM+157) and its exact own reading (DTM+597):
 * twelve days after the fixture's future supply start, as EDIFACT 203. */
export function z06fNativeChangeInstant(f:Pick<Z06fNativeWireScope,'requestedStartDate'>,extraDays=0){
 const date=new Date(`${f.requestedStartDate}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+12+extraDays)
 return `${date.toISOString().slice(0,10).replaceAll('-','')}0000`
}
export function z06fNativeStructureWire(f:Z06fNativeWireScope,kind:'F'|'G',document:string){
 const base=structuralOwnerSource('Z06',kind==='F'?'E64':'E32',document)
 return base.raw_payload!.replaceAll('735123456789012345',f.external).replaceAll('12345:14',f.receiver+':14').replaceAll('54321:14',f.sender+':14').replaceAll('NAD+FR+12345:160:SVK',`NAD+FR+${f.receiver}:160:SVK`).replaceAll('NAD+DO+54321:160:SVK',`NAD+DO+${f.sender}:160:SVK`)
  .replaceAll('12345:160:SVK',f.receiver+':160:SVK').replaceAll('54321:160:SVK',f.sender+':160:SVK')
  .replaceAll('NAD+Z02+11111:160:SVK',`NAD+Z02+${f.brpEdielId}:160:SVK`).replaceAll('RFF+LI:CASE-1',`RFF+LI:${f.caseReference}`).replaceAll('RFF+Z05:NET-1',`RFF+Z05:${f.gridAreaCode}`)
  .replaceAll('DTM+92:202610010000:203',`DTM+92:${f.requestedStartDate.replaceAll('-','')}0000:203`).replaceAll('DTM+157:202610150000:203',`DTM+157:${z06fNativeChangeInstant(f)}:203`)
}
export type Z06fNativeReadingOptions={register?:string;meter?:string;agency?:string;point?:string;date?:'next-day';quantity?:string}
export function z06fNativeReadingWire(f:Z06fNativeWireScope,options:Z06fNativeReadingOptions={}){
 let raw=priorE30PointWire('E64',options.meter??'METER-1',options.point??f.external).replaceAll('91100',f.receiver).replaceAll('21660',f.sender).replaceAll('RFF+AES:101',`RFF+AES:${options.register??'101'}`)
  .replaceAll('LOC+239+TES:SVK:260',`LOC+239+${f.gridAreaCode}:SVK:260`).replaceAll('202610150000',z06fNativeChangeInstant(f,options.date==='next-day'?1:0)).replaceAll('QTY+220:10000',`QTY+220:${options.quantity??'10000'}`)
 raw=raw.replaceAll('GRIDEX2607E66001','READ-'+randomUUID().replaceAll('-','').slice(0,28)).replaceAll('GRIDEX2607E66MSG001','DOC-'+randomUUID().replaceAll('-','').slice(0,28))
 if(options.agency)raw=raw.replace(`LOC+172+${options.point??f.external}::9`, `LOC+172+${options.point??f.external}::${options.agency}`)
 return raw
}
