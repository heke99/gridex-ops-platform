# Minimal real T4 → T3 physical .03 handoff

SOURCE ONLY; native/event/allocation NOT_RUN. Candidate and hashes: `postproof-importer-final-manifest.private.json`. Frozen 3 source files; 42 finite tests pass. Existing consumer, .03 two-variant physical oracle, canonical backend, full-v1 roles, one-attempt and cleanup remain unchanged. The source request JSON intentionally leaves actual future allocation/source fields null.

The one required genuine allocation is the existing T4 ordinary producer/backend full native role package for the exact reviewed physical .03 source and one exclusive attempt. No issuer1030 SQL/GEN, issuer underlay, T1/T2 or Nordfin allocation is required. Signatures authenticate delivery, not grants. An event still needs actual prior event/producer authorization; this document does not dispatch one.

T3 ROOT has two distinct OFF-HOST private keys: evidence decryption and assignment signing. T4 gets only public certificate/public signer pin and source. T4 does not get private keys or shared-filesystem access. The public certificate is `/workspace/t3-handoff-20261101/native-evidence-keys/recipient.pem`, SHA `e1755b953fd31cec33f21a9ecc0b8b991ea711d25116032d5b3681b5109e1e58`; signer public SPKI SHA `d9be7792c4a381476bcb0b58646cb86caf01736d2264cc355333ee0c7ea41704`. Both exact public bytes are source-pinned. Paths here are ROOT-local, not promises of T4 access.

1. ROOT binds the actual reviewed final source commit/tree/scenario hash. The authorized actual job checks out only H, validates real run/job/source/host capacity and empty backend inventory, creates a real ephemeral RSA3072 input key outside archived SIM_HOME, and posts only `t3-host-proof-envelope-v1` ciphertext to issue930. Nothing heavy starts. The private hostproof includes actual run/job/attempt/source/tree/boot/nonce/public key/workspace paths and the job cleanup deadline.
2. ROOT retrieves the actual ciphertext comment privately and verifies its provenance against the actual authorized job/event/source. ROOT decrypts exact proof bytes using its evidence private key. T4 supplies the genuine actual producer/backend package encrypted to the public evidence certificate, through the existing private ciphertext930 boundary. T3 ROOT decrypts locally; T4 never assumes ROOT filesystem or signer access. Actual capsule refs and role allocation remain T4-owned normal protocol. The actual packet uses hostproof paths and final source H=app=replay with three directories. Actual Auth actor IDs are created later by the normal fixture bootstrap, not fabricated in this input.
3. ROOT validates the actual mandate/allocation and independent source reviews, then signs that exact profile+file payload bound to actual proof SHA/run/job/attempt/source/tree/boot/nonce/ephemeral key/expiry. `seal-assignment` writes a private ciphertext carrier and size receipt. It rejects >58,000 ciphertext characters or >60,000 comment bytes; no chunk/fallback. Root then explicitly publishes once. An unknown POST is HOLD; the intent journal blocks blind repeat.
4. Running job reads issue930 FULL twice, with all ordered100-comment pages, count checks and stable content plus actual token quota reserve64. At375 comments this costs12 requests. Import wait max20minutes. Signed plan expiry separately <=proof observation+90minutes AND actual job start+90minutes, reserving10minutes of100-minute job for cleanup. It verifies ROOT-PSS and all real host bindings, reobserves same host/inventory, materializes exact existing private profile/file ABI exclusively, then checks out app/replay using verified exact source selector. It then performs normal real Packet/authority/one-attempt/tool/backend/build/pilot/cleanup. Ephemeral private key never enters SIM_HOME or the output archive.

Concrete commands below are a recipe ONLY; explicit variables are ROOT-private actual paths and must already exist. No command has been run with actual keys or posted ciphertext in this source task.

```sh
# On ROOT only, after obtaining actual authorized hostproof ciphertext body:
python3 -B "$T3_PROFILE" open-proof --proof-home "$OFFHOST_PROOF_HOME" \
  --ciphertext "$ACTUAL_HOST_PROOF_CIPHERTEXT" --evidence-key "$ROOT_EVIDENCE_PRIVATE_KEY"

# Actual profile.json and files.json come from real reviewed T4 allocation,
# plus ROOT-owned actual source review/mandate originals; no synthetic grants.
python3 -B "$T3_PROFILE" seal-assignment --proof-home "$OFFHOST_PROOF_HOME" \
  --profile "$ACTUAL_PRIVATE_PROFILE" --files "$ACTUAL_PRIVATE_FILES" \
  --signing-key "$ROOT_ASSIGNMENT_SIGNING_PRIVATE_KEY" --output "$PRIVATE_ASSIGNMENT_CIPHERTEXT"

# Separate explicit ciphertext-only publication. GH_TOKEN is the authorized
# publisher token supplied privately, never echoed. No retry after unknown.
python3 -B "$T3_PROFILE" publish-assignment --proof-home "$OFFHOST_PROOF_HOME" \
  --ciphertext "$PRIVATE_ASSIGNMENT_CIPHERTEXT"
```

For T4's encrypted producer material, the same source exposes `crypto_port('encrypt', value=<actual private object>, publicPem=unit.REVIEWER_CERT)` and ROOT exposes its inverse `crypto_port('open-proof', envelope=<received envelope>, privatePem=<ROOT-private evidence key>, publicPem=unit.REVIEWER_CERT)`. Import the exact reviewed profile module with Python importlib, keep results in exclusively-created0600 private files, never print plaintext. These functions use the actual donor Node built-in crypto/canonicalization; no npm or new protocol is needed. The producer material can contain `{profile,files}` for ROOT's explicit validation/sealing. Encryption alone is never issuer/native authority. Actual transport plaintext size must be checked against the same60,000-byte public envelope bound before any publication.

Finite measured positive includes86 source-shaped custody refs plus4 role/capsule refs, full producer/backend capsules, mandate and two independent review originals. Existing actual `private_authority` accepts both finite source-shaped capsules; this is a test, not actual permission. Payload33,347bytes, cipher45,184characters, carrier46,220bytes. Actual originals may be larger; sealing measures actual bytes and fails before POST on overflow. No source custody was weakened to fit.

The concrete complete JSON templates are `postproof-profile-template.private.json` and `postproof-input-files-template.private.json`. Every null is a required real binding; no synthetic grant/UUID/receipt SHA is substituted. Fixed config, scenario, lock, workflow, adapter, consumer hashes and actual86 custody refs are filled. `postproof-producer-request.private.json` lists exactly which remaining fields ROOT binds after commit, which T4 must actually allocate, and which derive exclusively from the decrypted real hostproof. The four null reservation rows are the two new actual role refs and two derived private-capsule SHA refs. No installed nodeModules lock is invented: existing locked_tools observes it after actual npm ci.

Before sealing, ROOT can run this read-only private validation command. It deliberately does not contact GitHub, allocate a role or start anything. It checks the completed profile's host binding, all file hashes, full existing capsule/mandate/independent-review guards and the signed transport ABI. Real live neutral-ref GET validation still occurs in the normal runtime before consuming its one attempt; passing this command is not native authority.

```sh
python3 -B - "$T3_PROFILE" "$ACTUAL_PRIVATE_PROFILE" "$ACTUAL_PRIVATE_FILES" "$OFFHOST_PROOF_HOME" <<'PY'
import base64,importlib.util,json,pathlib,sys
from types import SimpleNamespace
try:
    spec=importlib.util.spec_from_file_location('reviewed_t3_profile',sys.argv[1])
    unit=importlib.util.module_from_spec(spec);spec.loader.exec_module(unit)
    profile=unit.strict_json(pathlib.Path(sys.argv[2]).read_bytes())
    files=unit.strict_json(pathlib.Path(sys.argv[3]).read_bytes())
    raw=(pathlib.Path(sys.argv[4])/'host-proof.private.json').read_bytes()
    proof=unit.strict_json(raw);proof['proofSha256']=unit.hash_bytes(raw)
    def complete(value):
        if value is None:return False
        if isinstance(value,dict):return all(complete(v) for v in value.values())
        if isinstance(value,list):return all(complete(v) for v in value)
        return True
    unit.need(complete(profile) and complete(files),'actual_binding_required_no_null_template')
    payload=unit.proof_payload(proof,profile,files,profile['plan']['expiresAtUtc'])
    _,originals=unit.validate_assignment(payload,proof)
    unit.need(profile['plan']['appCommit']==profile['plan']['harnessCommit']
              and profile['plan']['appTree']==profile['plan']['harnessTree'],'same_actual_reviewed_physical_source_required')
    unit.need(profile['plan']['execution']['purpose']=='ediel03_physical'
              and profile['plan']['execution']['scenarioFile']=='scenarios/ediel03-03.test.ts','physical_only_request')
    # Map only the exact received bytes for offhost validation; never rewrite
    # host-bound paths or create/adopt a runtime fixture on ROOT's workstation.
    originals=dict(originals)
    class Original:
        def __init__(self,raw):self.raw=raw
        def read_bytes(self):return self.raw
    home=pathlib.Path(profile['plan']['simHome'])
    def private(path):
        relative=pathlib.Path(path).relative_to(home)
        unit.need(len(relative.parts)==2,'exact_received_original_path_required')
        return Original(originals[tuple(relative.parts)])
    for role,binding in profile['authorities'].items():
        unit.private_authority(profile,profile['plan'],binding,role,proof['identity'],SimpleNamespace(private=private))
    print('T3_PRIVATE_BINDING_CHECKED_NOT_NATIVE_AUTHORITY')
except Exception:
    print('T3_PRIVATE_BINDING_HOLD',file=sys.stderr);sys.exit(1)
PY
```

Transport HOLD retention: failed proof/import always attempts a separate RSA-OAEP/AES-256-GCM encrypted archive. It includes only explicit JSON proof/intent/API journal filename originals, a safe terminal stage/errorclass/allowlisted internal reason and partial materialization inventory. It never tars proof_home or traverses the ephemeral private PEM. Normal successful import retains the existing CMS archive path unchanged. Actual test-only decryptions verified unknownPOST, early capacityUNKNOWN and partial materialization evidence; no actual native/host effects were run.
