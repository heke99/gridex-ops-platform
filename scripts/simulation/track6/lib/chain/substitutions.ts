// Ursprung: 3ea5cd2b6d37b910674e71993ac94e5720ed31a8 (origin/claude/sim-20261029-track1):scripts/simulation/track1/fixtures/substitutions.ts
// Oförändrad kopia. Register över varje steg där en normal ingång ersatts av ett ersättningssteg (raw SQL, in-process anrop).
// Konvention i koden: `// SUBSTITUTE: <vad> — verifierar inte <vad>` intill anropet, plus en `substitute(...)` här.

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

/** Rapportformat: "ERSÄTTNINGSSTEG: <ersättning> — verifierar inte <vad>". */
export function substitutionObservation(entry: Substitution): string {
  return `ERSÄTTNINGSSTEG: ${entry.substitute} — verifierar inte ${entry.notVerified}`
}
