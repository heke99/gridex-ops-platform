// Registry of every step where a normal entry point was replaced by a
// substitute. Scenarios write the list to ${TRACK1_RUN_DIR}/substitutions.json.
//
// Convention in code: `// SUBSTITUTE: <what> — verifierar inte <what>` next to
// the call, and one `substitute(...)` registration here.

export type Substitution = {
  id: string
  /** Where in the flow the substitute is used. */
  step: string
  /** What is used instead of the normal entry. */
  substitute: string
  /** What the run therefore does NOT verify. */
  notVerified: string
}

export const SUBSTITUTIONS: Substitution[] = []

export function substitute(entry: Substitution): void {
  if (!SUBSTITUTIONS.some(existing => existing.id === entry.id)) SUBSTITUTIONS.push(entry)
}

export function resetSubstitutions(): void { SUBSTITUTIONS.length = 0 }
