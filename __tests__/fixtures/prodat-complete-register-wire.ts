import { raw, characteristic, type Parts } from './prodat-register'
import { head } from './prodat-identity'
import { ud } from './prodat-ud'

// Fixed, independently selected full national fields surround the register
// mutation under test. No test override, renderer output or byCell grant.
export function completeRegisterWire(body: Parts[]): string {
  const blocks: Parts[][] = []
  for (const part of body) {
    if (part[0] === 'LIN') blocks.push([])
    if (!blocks.length) throw new Error('register fixture must start with its own LIN')
    if (part[0] !== 'NAD' || part[1] !== 'UD') blocks.at(-1)!.push(part)
  }
  const scoped = blocks.flatMap(block => {
    const lin = block[0], identity = lin[3] as readonly string[], register = lin[4] as readonly string[] | undefined
    if (register && register[1] !== '1') return block
    return [...block,
      ['DTM',['92','202610010000','203']], ['DTM',['354','15','806']],
      ...characteristic('Z04','Z03'), ...characteristic('Z07','Z12'),
      ...characteristic('Z12','D',3), ...characteristic('Z15','D'),
      ['CCI','','Z14'], ['CAV',['','','','L917']],
      ['RFF',['MG','METER-'+identity[0]]], ['RFF',['Z05','TES']], ['RFF',['LI','CASE-'+identity[0]]],
      ud(), ['NAD','IT',[identity[0],'',identity[3]],'','','Street','Town','','12345','SE'],
      ['NAD','Z02',['12345','160','SVK']],
    ] as Parts[]
  })
  return raw([...head(),...scoped], 'Z04').replace('+S+R+', '+12345:14+54321:14+')
}
