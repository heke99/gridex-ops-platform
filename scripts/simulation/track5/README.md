# Spår 5 – separat simuleringsharness (EVENT01, AUTH01, API01)

Kampanj `20261029-3f1a8ab1`, appbas `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. Ingen appändring på basen.

**Ursprung:** kopierad från spår 2:s harness, `origin/claude/sim-20261029-track2` @ `5b6b27be9401a260fba6bd90b5b6d39b40300ae6`, katalogen `scripts/simulation/track2/`. Filerna är `up.sh`, `run.sh`, `down.sh`, `lib/{common.sh,counterparts.mjs,db.ts,env.ts,fixture.ts,index.ts,make-report.mjs,prepare-supabase.py,session.ts,server-action.ts}`, `tsconfig.json`, `vitest.config.ts` och `scenarios/smoke.test.ts`.

**Avvikelser mot förlagan:**
- **Standardvärden:** `SIM_HOME=/root/sim-home/track5`, `RUN_DIR=/root/sim/track5`, app-port 3105 och motpartsport 3195.
- **`up.sh`:**
  - `SKIP_REPLAY` godtar bara tillagda migrationer sedan `replay-commit`.
  - `SKIP_BUILD` godtar bara ändringar utanför appen, enligt sim-runners lista.
  - Före en ny replay avbryter skriptet om en Supabase-stack redan kör.
  - Skriptet skriver `fingerprint` (replayskriptets verifierade värde) och `db-url`.
- **`run.sh`:** kräver `SIM_REPORT`. Ett kvarlämnat `run.lock` tas inte bort, utan skriptet vägrar starta. Vitest-loggen skrivs både till stdout och till `SIM_HOME/logs`.

Användning, klocka och neutraliserade externa integrationer är desamma som i spår 2:s README.
