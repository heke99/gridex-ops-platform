import { addBusinessDays, isBusinessDay } from '@/lib/ediel/calendar/marketCalendar'
import { canonicalDeadlineRuleForMessage } from '@/lib/ediel/rulebook/deadlinePolicy'

// AT-Z10M-SUPPLIER chronology helper: the send window is derived only from the
// canonical Z10M deadline row and the real market-calendar day stepping.
export function z10mSendDeadlineConstraint() {
  const rule = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z10', subtype: 'M' })
  const matches = rule?.constraints.filter(c => c.kind === 'within_after' && c.anchor === 'meter_replacement') ?? []
  if (!rule || matches.length !== 1 || matches[0].unit !== 'business_days' || typeof matches[0].offset !== 'number')
    throw new Error('z10m_deadline_constraint_missing_or_ambiguous')
  return { rule, offset: matches[0].offset }
}

const day = (value: string) => new Date(`${value}T00:00:00Z`)
const iso = (value: Date) => value.toISOString().slice(0, 10)

/** Latest permitted send date (inclusive) for a meter replacement on `replacementDate`. */
export async function z10mLatestSendDate(replacementDate: string): Promise<string> {
  return iso(await addBusinessDays(day(replacementDate), z10mSendDeadlineConstraint().offset))
}

/** Business-day ordinal of `sentDate` after the replacement (0 = same day or a non-business day before day 1). */
export async function z10mBusinessDayOrdinal(replacementDate: string, sentDate: string): Promise<number> {
  let ordinal = 0
  for (const cursor = day(replacementDate); iso(cursor) < sentDate;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (await isBusinessDay(cursor)) ordinal += 1
  }
  return ordinal
}

export async function classifyZ10mSend(replacementDate: string, sentDate: string) {
  const latest = await z10mLatestSendDate(replacementDate)
  return { latest, ordinal: await z10mBusinessDayOrdinal(replacementDate, sentDate), late: sentDate > latest }
}
