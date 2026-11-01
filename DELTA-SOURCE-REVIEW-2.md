# Independent capacity-observation retention source review

Decision: APPROVE_SOURCE_ONLY.

Exact frozen two-file scope on base `496288a56b0e7ef4e5043604d7fadcaf4a1f3376`:
- hosted-profile.py `f16faf3ad510bf50e291fa7347566812677808bc217b9bc99167367f52a78edf`
- hosted-profile.test.py `8daea9b343992769516c978c14e25d14810073d68f25bf39fca481fd32c167eb`

Independently verified both hashes and focused diff. Production change is only one additional explicit transport archive JSON whitelist member plus hostproof obtaining the actual returned host_identity(enforce_capacity=False) observation, saving it privately0600, then requiring the same capacityStatus QUALIFIED and calling the unchanged prepare.capacity(driver,effectiveRamBytes,freeBytes). Workflow and actual prepare.py bytes/floors independently unchanged. Receive/preflight and all other lifecycle/native/source/authority checks are unchanged.

The diagnostic flag does not admit UNKNOWN: UNKNOWN/null is saved and then fails the original qualified-status need before inventory/key/proofPOST. A QUALIFIED label cannot override the actual8GiB RAM and15GiB overlay/40GiB vfs floors; original capacity() still enforces them. Retaining the exact returned capacityObservation preserves its existing reason and available details without fabricating absent kernel information. Host-identity failures before any return still use existing terminal failure handling and cannot manufacture an observation.

Fresh independent complete suite45/45passed. New meaningful cases verify complete UNKNOWN subreason survives actual encrypted-HOLD archive and decrypt, boundary QUALIFIED invokes original floor function before publication, and underfloor7GiB stays HOLD with no key/POST. Existing42crypto/native-capsule/transport-HOLD tests remain green. No actual key, Docker/backend, API/event, source edit or native attempt executed by reviewer.

Prior independent full61physical composition review applies to the unchanged other59files and source behavior outside this exact2delta. Final adoption must bind new committed whole-source tuple; this private candidate approval does not rebind prior actual failed run or authorize another event/attempt. Actual failed-hostproof receipt remains exact496288/HOLD and cannot become positive from this fix. Native allocation/output acceptance, T4 budget and AS-TEST remain separate unqualified gates.
