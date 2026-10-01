# Native beneficiary provenance and retained receipt repair

Component baseline: `5e38e646c1b7a2aa0996935247801ed23339cb4d`, with the previously delivered incident `counts` helper correction applied as `39058c9f` for local scripts compilation. This is a component result, not the final integrated candidate or masterplan approval.

## Concrete correction

CLI-created forward migration `20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql` replaces the same public beneficiary page function without changing its signature, OID or ACL. The complete current filtered permission, actor, purpose/fields, native source-role, original wire and stored contract checks remain before any receipt access. A transaction advisory lock uses only the server-derived full proof hash. Under that lock an exact existing receipt returns without an attempted INSERT. A missing receipt is inserted once; a hash/proof conflict fails closed. No immutable migration is rewritten.

The original `022500` consumer attempted `INSERT ... ON CONFLICT` on every retained read. A real PostgreSQL BEFORE INSERT tripwire fails that baseline and passes the new forward owner. Neither a retained receipt nor caller JSON grants current read authority.

## Bounded receipts

- RED: `EDIEL_PROJECTION_REPLAY_BASELINE=1 EDIEL_PGLITE_MODULE=... EDIEL_SQL_REPOSITORY=... node scripts/ediel-beneficiary-projection-replay-sql-regression.mjs`, exit 1, `projection_insert_attempt` at the exact retained read. Receipt: `/tmp/ediel-projection-replay-forward-red.log`.
- GREEN: the same command without the baseline flag, exit 0. Four new checks cover retained quantity/quality pages with zero attempted inserts, outside-purpose/fields denial, current membership denial, and rollback on a last receipt INSERT failure; the same public OID/ACL is asserted separately. The existing bounded source/provenance/service suites also run: 23 + 21 + 11 + 35 checks. Receipt: `/tmp/ediel-projection-replay-forward-sql.log`.
- `node node_modules/typescript/bin/tsc -p tsconfig.scripts.json --noEmit --pretty false`, exit 0. Receipt: `/tmp/ediel-projection-replay-scripts-tsc.log`.
- Focused ESLint on the native fixture and new bounded runner, exit 0. Receipt: `/tmp/ediel-projection-replay-lint.log`.

The SQL runner executes the actual new owner body. Its inherited source, storage, review and permission boundaries are explicitly finite synthetic dependencies. It does not demonstrate native RPC authorization, concurrent PostgreSQL sessions or actual legal approval.

## Genuine native proof prepared, unexecuted locally

The added ESCO11 case in `scripts/ediel-service-evidence-native.test.ts` uses two separate real archive/HMAC/separate-review/assignment/Z13/Z14/grant producer chains, then real accepted UTILTS storage. Only the external SMTP transport and explicitly synthetic external issuer registry inputs are replaced. No private accepted/verified/grant receipts are seeded.

The real HTTP/native read must expose the same original DGI role, original application reference, legal sender, source hash and native contract hash to both beneficiaries while retaining different purpose and field scopes. Quantity-only pages expose no quality origin or raw source. A separately authorized quality page identifies its original column. Concurrent identical requests must return one receipt. A BEFORE INSERT tripwire then enforces no attempted writes on exact retries, wrong purpose, unapproved quality, foreign grant and current DENY. A new qualified page deliberately failing at the final receipt write must leave no new receipt or business effects.

This native case has not run in this workspace: there is no local disposable Supabase/PostgreSQL stack. It is included in the ordinary native suite by the existing configuration, which this package does not change. Actual source qualification may independently hold where the frozen APERAK 96A and Swedish dual-original-reference requirements conflict; this package does not suppress those references or fabricate market approval.

Whole ESCO11, SC005/006, ACK and masterplan criteria remain partial until the same frozen integrated candidate has authentic native, browser, build and exact-head CI receipts for every literal expected/prohibited clause and its real external prerequisites.
