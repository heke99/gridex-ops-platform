import {observationHandoffMessage} from './utiltsObservationHandoff'

/** Own observed bytes only; expected meter and registers must come from a
 * separately reviewed PRODAT source. Keep the singleton without a period. */
export function priorE30PointWire(reason:'E20'|'E77'|'E24'|'E25'|'E67'|'E64',meter:string,point:string){
 const message=observationHandoffMessage('2026-09-30')
 const lines=message.raw_payload!.split('\n')
 const start=lines.findIndex(line=>line.startsWith('SEQ++1'))
 const end=lines.findIndex(line=>line.startsWith('UNT+'))
 lines.splice(start,end-start,
  "SEQ++1'","RFF+AES:101'",`RFF+MG:${meter}'`,"QTY+220:10000'","DTM+597:202610150000:203'")
 const remove=(prefix:string)=>{const index=lines.findIndex(line=>line.startsWith(prefix));if(index>=0)lines.splice(index,1)}
 remove('DTM+324:');remove('DTM+354:')
 return lines.join('\n').replace('BGM+E66','BGM+E30').replaceAll('23-DDQ-E66-S','23-MDR-E30-T')
  .replaceAll('735999260731000007',point).replace('STS+7++E88',`STS+7++${reason}`)
  .replace('?+0200','?+0100').replaceAll('202608010000','202610150000')
  .replaceAll('UNT+35+1',`UNT+${lines.length-2}+1`)
}

export function priorE66MembershipWire(raw:string,kind:'missing'|'excess'){
 const lines=raw.split('\n'),first=lines.findIndex(line=>line.startsWith('SEQ++1')),
  energy=lines.findIndex(line=>line.startsWith('SEQ++3'))
 if(first<0||energy<0)throw Error('prior_register_fixture_shape')
 const period=raw.match(/DTM\+324:(\d{12})(\d{12}):719/)
 if(!period)throw Error('prior_register_period_shape')
 if(kind==='missing')lines.splice(first,energy-first)
 else {lines.splice(energy,0,"SEQ++3'","RFF+AES:901'","RFF+MG:METER-1'","QTY+220:10500'",`DTM+597:${period[1]}:203'`,
  "SEQ++4'","RFF+AES:901'","QTY+220:10500'",`DTM+597:${period[2]}:203'`)
  lines[energy+9]="SEQ++5'"}
 const end=lines.findIndex(line=>line.startsWith('UNT+'))
 lines[end]=`UNT+${lines.length-2}+1'`
 return lines.join('\n')
}
