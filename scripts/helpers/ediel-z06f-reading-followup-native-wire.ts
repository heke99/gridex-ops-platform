// Physical synthetic source input only; these bytes do not qualify any source,
// current legal role, applied structural state, accepted reading or data grant.
import {randomUUID} from 'node:crypto'
import {structuralOwnerSource} from '../../__tests__/helpers/structuralOwnerFixtures'
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
/** A supplier receives the grid owner's register reading as E66 (DDQ); E30 is
 * only ever received by a grid owner. One daily E66 period starts at the
 * change instant: SEQ1 is the own start reading at that exact instant, SEQ2 the
 * period end reading and SEQ3 the period energy. In this scope `receiver` is
 * the grid owner (MS) and `sender` the receiving supplier (MR). */
export function z06fNativeReadingWire(f:Z06fNativeWireScope,options:Z06fNativeReadingOptions={}){
 // One declared offset applies to both bounds. A one-day interval remains
 // 24 hours after conversion, including month/leap and DST-calendar boundaries.
 const start=z06fNativeChangeInstant(f,options.date==='next-day'?1:0),endDate=new Date(Date.UTC(+start.slice(0,4),+start.slice(4,6)-1,+start.slice(6,8)+1))
 const end=`${endDate.toISOString().slice(0,10).replaceAll('-','')}0000`,point=options.point??f.external,quantity=options.quantity??'10000',register=options.register??'101'
 const document='DOC-'+randomUUID().replaceAll('-','').slice(0,28),transaction='READ-'+randomUUID().replaceAll('-','').slice(0,28)
 const lines=["UNA:+.? '","UNB+UNOC:3+"+f.receiver+":ZZ+"+f.sender+":ZZ+260831:1811+260831181101++23-DDQ-E66-T++1'","UNH+1+UTILTS:D:02B:UN:E5SE5A'",`BGM+E66::260+${document}+9+AB'`,
  "DTM+137:202609301811:203'","DTM+735:?+0100:406'","MKS+23+E02::260'",`NAD+MS+${f.receiver}:SVK:260'`,`NAD+MR+${f.sender}:SVK:260'`,"NAD+DDQ'",`IDE+24+${transaction}'`,
  `LOC+172+${point}::${options.agency??'9'}'`,`LOC+239+${f.gridAreaCode}:SVK:260'`,"LIN+++8716867000030:::9'",`DTM+324:${start}${end}:719'`,`DTM+597:${end}:203'`,"DTM+354:1:804'","STS+7++E64::260'","MEA+AAZ++KWH'","CCI+++E12::260'","CAV+E17::260'",
  "SEQ++1'",`RFF+AES:${register}'`,`RFF+MG:${options.meter??'METER-1'}'`,`QTY+220:${quantity}'`,`DTM+597:${start}:203'`,"CCI+++E22::260'","CAV+E27::260'",
  "SEQ++2'",`RFF+AES:${register}'`,"QTY+220:11000'",`DTM+597:${end}:203'`,"CCI+++E22::260'","CAV+E27::260'","SEQ++3'","QTY+136:500'"]
 return [...lines,`UNT+${lines.length-1}+1'`,"UNZ+1+260831181101'"].join('\n')
}
