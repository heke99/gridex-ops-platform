# F3C-05 / E036: UTILTS header market before function

Base is draft PR #375, stacked on draft PRs #374, #373 and #372. PR #310 remains excluded.

UTILTS 25-A-3 common header field 501 is MKS/7293, required for normal messages; the retained canonical field rule allows market codes 23/27 (`rulebook/fieldMatrix.ts`). Masterplan §4.2 and annex E036 require a header guide failure to yield negative APERAK for the whole message, without a functional rejection. The existing canonical decision calls `runUtiltsRuntimeForMessage`; its legacy validation checks functional E66 quantity consistency but did not consume field 501. In a complete monthly E66 original with real 1000/500 E19 mismatch, changing only `MKS+23` to `MKS+99` produced `functional_rejected` and ERR. The focused test confirmed RED.

The facade now reads the first MKS value using the declared UNA and the existing field-501 rule. Missing/invalid market yields a qualified guide issue (ERC41/42, field501). As this is a header failure, the final result removes functional error findings for all IDEs (including a message without parsed IDE identity), rebuilds dispositions and ACK plan, and leaves both the raw original and warnings available. The real canonical decision now chooses negative APERAK; the ACK draft contains FTX501 and no UTILTS_ERR plan. Tests also cover absent MKS and custom UNA value extraction. The legacy pure functional calculations still execute before this final facade pass; this is a correction of externally observable outcome, **not** proof of literal staged execution or full header/grammar coverage. Multi-message per-message completeness remains unqualified.

Local RED: new invalid MKS test failed at `functional_rejected`. GREEN: 24 UTILTS test files, 270/270; app/test typechecks, scoped ESLint and diff check passed. Ordinary exact-head CI is required after publication. No staging, hosted DB, market send or production execution.

Next: test another source-qualified header field through its actual canonical/persisted response boundary, then the mixed unreferenced functional finding and native disposition/ACK/storage cases. F3C-04 native Z04 and F3C-06 grammar/F3C-07 ledger remain open.
