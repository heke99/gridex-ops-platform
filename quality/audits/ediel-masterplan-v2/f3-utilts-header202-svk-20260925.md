# UTILTS S-code BGM qualifier, field 202

Annex C row UG-122-5 requires `BGM/C002/1131=SVK` when the physical document code in 1001 is S01–S07. The shared final header guide already validates 3055=260 but did not consume 1131. A complete S07 original without that qualifier produced no field-202 application finding. The focused runtime case was RED before the change.

The header guide now projects missing 1131 as ERC41/field202 and a value other than SVK as ERC42/field202. A valid S07:SVK:260 control has no field-202 finding. A test through `processInboundUtiltsMessage`, with external boundaries mocked, shows `guide_rejected`, negative APERAK and no meter, billing or completion effect. This remains an observable final decision; literal ordering of the older functional calculation and native stored multi-IDE composition are separate F3C-05 work.

Local verification: 288/288 UTILTS tests in 24 files, app/test typechecks, scoped ESLint and diff check passed. No database migration, staging, TGT/AGT, counterparty or market send. PR #372 was merged to main at `8b0d5c83`; this follow-up is a separate branch and requires its own exact-head CI before acceptance. Field203 durable tenant-bound uniqueness and other F3/masterplan work remain open.

First PR #385 head `ebe48be5` found an accepted S07 unit fixture with `BGM+S07::260`; a fixture-only correction passed 62/62 targeted tests at head `66bb2d17`. Its clean replay then reported 340/343 native: three older accepted S07 controls had the same missing qualifier. The second fixture-only correction changes those three synthetic originals to `S07:SVK:260`. Product validation is unchanged. Final native and exact-head CI remain pending on this correction.
