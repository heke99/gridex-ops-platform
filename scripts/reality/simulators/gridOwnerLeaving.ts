// What a grid owner sends the supplier when a customer leaves (reality scenario H). Pure EDIFACT builders plus
// one SMTPS send as the grid owner's mailbox; no database access.
//
//   PRODAT Z05 L  (CAV Z22)  end of supply: another supplier takes over the facility (switch away)
//   PRODAT Z05 LK (CAV Z23)  end of supply: a new customer moved in with another supplier (move-out)
//   PRODAT Z04 C  (CAV Z24)  the grid owner confirms the supplier's own cancellation (Z03C) of a pending switch
//
// The Z05 has the shape of the platform's approved national end acceptance fixture
// (scripts/helpers/ediel-national-end-native-fixture.ts); the Z04C is the simulator's Z04 for the received
// Z03C (scripts/reality/simulators/gridOwnerWire.ts) with the cancellation reason. The default simulator
// (gridOwner.ts) answers every Z03 with an L confirmation, including a Z03C; scenario H delays that answer
// (profile z04DelayMs) while it cancels, and the report gives the patch that makes the simulator answer C.
import { randomUUID } from 'node:crypto'
import { guideOrderedFixtureRaw } from '../../../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, line, type Parts } from '../../../__tests__/fixtures/prodat-register'
import nodemailer from 'nodemailer'
import { buildZ04ForSwitchRequest, readSwitchRequest } from './gridOwnerWire'
import { platformMailboxFor } from './platformMailbox'

export type LeavingFacts = {
  gridOwner: string; supplier: string; point: string; gridArea: string; brp: string
  customerIdentity: string; customerName: string
  /** DTM+93 in Ediel fixed normal time, CCYYMMDDHHMM (00:00 = the first day no longer supplied). */
  endMinute: string
  /** L: switch away (Z22), LK: change of customer and supplier, i.e. the customer moved out (Z23). */
  variant: 'L' | 'LK'
  /** The grid owner's case reference (RFF+LI) of the other supplier's request. */
  li?: string
  /** UNB identification code qualifier of the parties (the one our own files use; default 14). */
  qualifier?: string
}

const ediel = (date: Date) => date.toISOString().slice(2, 16).replace(/[-T:]/g, '')

/** PRODAT Z05 from the grid owner to the supplier that loses the facility. */
export function buildZ05End(f: LeavingFacts) {
  const li = f.li ?? `${f.variant}${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`
  const body: Parts[] = [
    ['NAD', 'FR', [f.gridOwner, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', [f.supplier, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', f.point, undefined, '9'),
    ['DTM', ['93', f.endMinute, '203']],
    ...characteristic('Z13', f.variant === 'L' ? 'Z22' : 'Z23'),
    ['RFF', ['LI', li]], ['RFF', ['Z05', f.gridArea]],
    ['NAD', 'UD', [f.customerIdentity, 'SE2', '260'], '', f.customerName, 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [f.point, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.brp, '160', 'SVK']],
  ]
  const interchange = `I${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const document = randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()
  const now = new Date()
  const raw = guideOrderedFixtureRaw(body, 'Z05')
    .replace('+S+R+', `+${f.gridOwner}:${f.qualifier ?? '14'}+${f.supplier}:${f.qualifier ?? '14'}+`)
    .replace('+260917:1200+', `+${ediel(now).slice(0, 6)}:${ediel(now).slice(6, 10)}+`)
    .replace("++23-DDQ-PRODAT'", "++23-DDQ-PRODAT++1++1'")
    .replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')/, `+${interchange}$1`)
    .replace(/UNZ\+1\+I'/, `UNZ+1+${interchange}'`)
    .replace('BGM+Z05+D+9+AB', `BGM+Z05+${document}+9+AB`)
    .replace('DTM+137:202609171200:203', `DTM+137:20${ediel(now)}:203`)
  return { raw, reference: interchange, li }
}

/** PRODAT Z04 C: the grid owner confirms the cancellation (Z03C) it received for a pending switch. */
export function buildZ04CancellationFor(z03c: string, gridOwnerEdielId: string) {
  const facts = readSwitchRequest(z03c)
  const confirmation = buildZ04ForSwitchRequest({ request: z03c, gridOwnerEdielId })
  // The Z03C names the cancelled L/LK original by its case reference and start; the answer carries reason Z24.
  const raw = confirmation.raw.replace(/(CCI\+{2,3}Z13'\s*CAV\+)Z2[23]/, '$1Z24')
  if (raw === confirmation.raw) throw Error('z04c_reason_not_rewritten')
  return { raw, reference: confirmation.reference, facts }
}

/** One file from the grid owner's mailbox to the platform's Ediel mailbox over SMTPS. */
export async function gridOwnerSendsLeavingFile(input: { from: string; kind: string; edifact: string; reference: string }) {
  // Same transport as the grid-owner simulator: local GreenMail over SMTPS, TLS verified via the local CA.
  const transport = nodemailer.createTransport({ host: 'localhost', port: Number(process.env.REALITY_SMTPS_PORT ?? 3465), secure: true, requireTLS: true,
    auth: { user: input.from, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  await transport.sendMail({ from: input.from, to: platformMailboxFor(input.edifact), subject: `${input.kind} ${input.reference}`,
    text: 'Ediel', attachments: [{ filename: `${input.kind}_${input.reference}.edi`, content: input.edifact, contentType: 'application/edifact' }] })
}

/** Facts of a Z05 as read back from its wire (for the report). */
export function readLeavingWire(raw: string): Pick<LeavingFacts, 'endMinute' | 'variant'> & { li: string } {
  const end = /DTM\+93:(\d{12}):203/.exec(raw)?.[1] ?? ''
  const reason = /CCI\+{2,3}Z13'\s*CAV\+(Z2[23])/.exec(raw)?.[1]
  const li = /RFF\+LI:([^']+)'/.exec(raw)?.[1] ?? ''
  return { endMinute: end, variant: reason === 'Z23' ? 'LK' : 'L', li }
}
