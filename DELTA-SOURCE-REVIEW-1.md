# Independent focused capacity-observation retention source review

Verdict: **APPROVE_SOURCE_ONLY — TWO-FILE DELTA**, for base496288a56b0e7ef4e5043604d7fadcaf4a1f3376 and exact frozen candidates:

- hosted-profile.py SHA `f16faf3ad510bf50e291fa7347566812677808bc217b9bc99167367f52a78edf`.
- hosted-profile.test.py SHA `8daea9b343992769516c978c14e25d14810073d68f25bf39fca481fd32c167eb`.
- Freeze manifest SHA `40d0e1f132daca6ec8e65e46994534e22d35e6e302cb04b2af574315c3964774`.

Independently verified both hashes and reviewed the complete exact delta against accepted base. No remaining concrete blocking finding in this focused change.

The hostproof path calls actual host_identity(enforce_capacity=False), saves its exact returned object exclusively as private capacity-observation.private.json, then separately requires capacityStatus=QUALIFIED and invokes the same prepare.capacity driver/RAM/free-space floors. Only after those unchanged admission requirements does inventory/keygen/proof publication continue. The existing encrypted transport-HOLD archive adds this one filename to its explicit JSON whitelist; no whole-directory or private-key export is introduced. If host_identity itself cannot return an observation, the existing safe error journal remains the evidence; this patch does not fabricate missing fields.

This closes the observed actual-run diagnostic gap prospectively: a returned UNKNOWN observation and its retained subreason can survive the later guard exception, while unknown or underfloor capacity still blocks before inventory, keygen, POST or heavy execution. It does not retroactively supply the missing actual observation from run41359894482.

Independent actual finite suite:45/45 passed, exit0. New controls execute the real CLI path with finite kernel/Docker observations and actual archive encrypt/decrypt using fresh test keys: UNKNOWN saves the exact object before refusal; QUALIFIED passes only through the original floors;7GiB remains rejected with retained bytes and no key/POST. Existing42 controls remain green. No actual key, network/event, backend or database was accessed by the reviewer.

Workflow SHA3f2df4ba… is unchanged. Receive/import, preflight, canonical consumer, authority/attempt budget, physical scenario/oracles and cleanup are unchanged, so prior independently reviewed baseline runtime applicability remains valid for these unchanged paths. This approval is not a new event, grant or retry permission and does not qualify any actual host/observation/data result.

Reviewer `/root/review_t3_admission` did not author either changed file and is independent for this two-file delta. Reviewer is a coauthor of accepted __tests__/simulation-t3-e01-physical-count.test.ts from the earlier E01 donor; therefore this receipt must **not** be represented as an independent final review of the complete61-file source packet or E01 implementation. An eligible whole-scope final reviewer must bind the future complete commit/tree and actual authors union. No runtime GO, full-source final, native/GEN/data approval or scenario PASS follows from this focused receipt.
