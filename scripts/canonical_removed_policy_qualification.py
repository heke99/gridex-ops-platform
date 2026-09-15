"""Supplemental formula/catalog proof for 59 removed-policy source dispositions.

No new business DML matrix. An existing real-helper actor receipt is necessary,
not sufficient: exact live policy/helper metadata and effective ACLs are checked
separately. Full schema acceptance remains a parent-owned independent gate.

Logical reuse is narrow: the pinned retained W body requires an existing non-NULL
active/onboarding company, an allowed session and platform or writable membership;
therefore W implies N and R. The pinned R and user-company-ID bodies implement
the same membership/status conditions as expanded SELECT guard G, so R and G
have identical IS TRUE acceptance, including NULL-company platform reads. The
existing real-helper actor receipt qualifies those helpers on actual Auth rows;
it does not qualify the new policy identities. This module separately closes the
entire 267-policy inventory, checks all applicable branches and proves INSERT
CHECK and UPDATE USING/CHECK independently with SQL three-valued semantics.
Invitations/user_roles writes and final send-lock writes use measured ACL denial,
not a fabricated formula proof. Source register evidence still marks whole-schema
acceptance false; no new table name or metadata hash alone authorizes a business
operation. Canonical RPC bodies/ACLs are metadata-preservation checks, not an
execution of their business graphs. Parent guards bind the actor receipt and
owned target to the same seven-source execution and retain ledger responsibility.
"""
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
import canonical_policy_actor_qualification as actors

ROOT=Path(__file__).resolve().parents[1]
SOURCE='scripts/sql/canonical-removed-policy-qualification.sql'
REGISTER='quality/audits/PR310_REMOVED_POLICY_DISPOSITIONS_2026-09-15.json'
SOURCE_SHA='affa046451bc7aded834cbe37f2457e69f613e5746dbca32472ccf84c07a7138'
REGISTER_SHA='c31aa24d507a2f927d93685299f0ebf84e588ce32134a5f91f9db4f1c864f189'
TABLES=('audit_logs', 'auth_email_events', 'communication_routes', 'company_customer_number_sequences', 'company_invitations', 'customer_addresses', 'customer_authorization_documents', 'customer_contacts', 'customer_contract_events', 'customer_documents', 'customer_info_request_events', 'customer_internal_notes', 'customer_operation_tasks', 'ediel_actor_settings', 'ediel_route_profiles', 'ediel_send_locks', 'grid_owner_data_requests', 'inbound_processing_jobs', 'metering_permissions', 'outbound_dispatch_events', 'outbound_requests', 'partner_exports', 'user_roles')
ADDED_POLICY_HASHES=(
    (('public', 'audit_logs', 'gridex_mp_1665771f0351e5ab1ed1'),'33e7f335b901f40fbc06d46aacb6343e7bef1031003a333ff28ee67a9cb19d96'),
    (('public', 'audit_logs', 'gridex_mp_1b5c68d9fae31870abd4'),'f0ab8082348ab04cc5072d492e32121c27434d3f876f8813a6819d2b092717d7'),
    (('public', 'audit_logs', 'gridex_mp_9bed05b49fafdc78d18b'),'53df1e8d8f97eb7dad6ebb63933d22d3349cc2438fd1a2090031a0dc92e0c054'),
    (('public', 'audit_logs', 'gridex_mp_a3e732c5d18bfa4477f7'),'d2a4bf6ca7283c14fc9050ee192d83c4f3b9ff10b210ac707a530b1400a2ec91'),
    (('public', 'audit_logs', 'gridex_mp_e185c4f1c4faa621e763'),'782df18a820280215f262727364e75c7b9e57a5564accfdf66eba794b0f8677b'),
    (('public', 'audit_logs', 'gridex_mp_e8534998783068d30ad5'),'8bb3c8a1f2583ed1b4ba85ff95e67b0ee0eec75ca223da4469cab3245a5370cc'),
    (('public', 'audit_logs', 'gridex_perf_authenticated_select_v1'),'cd121127afcb18d5f7c7a94e8bf40a134825589418127fc4271a98f57baa273b'),
    (('public', 'auth_email_events', 'gridex_mp_13625bd8b3d32667c026'),'b5757fc476a334239cd8bdb62e99a17ca1daf990823314836e45c709528761cd'),
    (('public', 'auth_email_events', 'gridex_mp_13d5565c87ff8433f60c'),'1009a6371df5ce8533de4badfc605f3b8edcd56c64841704eb7d228061745029'),
    (('public', 'auth_email_events', 'gridex_mp_5c9dfbd5db2a8d69ca34'),'04b857a567ef0d25c1e5aab36f05cb3ceb0386fb51f6e349b68e0b6b123cc807'),
    (('public', 'auth_email_events', 'gridex_mp_697ca22a9c5f9995b502'),'46f5a71c74b8dd80965448e98f6683bcea5ca2b3a4b7792ac137d3d4b346857a'),
    (('public', 'auth_email_events', 'gridex_mp_79055d34ae958527ce5a'),'e89daf498ad5987200aef6977a5fe3cc20c2fa9f73fff16553022d58f82c79cb'),
    (('public', 'auth_email_events', 'gridex_mp_c9f121983b9558044ec4'),'e5f7f9066ef3b1c2ec0613fd1a6c7ab5dab9ab5d83285c3d6b7029c4be3bc4ab'),
    (('public', 'auth_email_events', 'gridex_mp_d9fcf01e9a04ddc166d5'),'09cdbaf1e9a51dd9cbe914b02fcbb07fb50637ec09c8dcd8ea69a4555c052f9f'),
    (('public', 'auth_email_events', 'gridex_mp_e778897a8dde9b9a86df'),'7efe513f3b08485457cb57df30526e0733f124f24fda012d93c1fa957215956f'),
    (('public', 'communication_routes', 'gridex_mp_2bbf4b53469fd6178461'),'95bd00e515d5a61bf2475080b16122f6d6d67d5f541174ede3ddbae524740d3d'),
    (('public', 'communication_routes', 'gridex_mp_37c7dade7db3a26d7467'),'e645ff85a1c3ed96305322ba4763f2358ae87c03dd334059caeff277f28eeebc'),
    (('public', 'communication_routes', 'gridex_mp_5de076c3eac7a481c45c'),'bb7d2b109390241fb7490a5e31d2da0e30e4cbf82c5379aaefc8575bd6ecfdb0'),
    (('public', 'communication_routes', 'gridex_mp_60aad04598f1a36b56ae'),'ed19c140828171a44c0a26c11d9d0404427de1ffb8b4413c036ba5965a4f5f0d'),
    (('public', 'communication_routes', 'gridex_mp_8ce55d030c258cc5474f'),'2b8d63bd0f2fc6c8ee614d2d382c2fc39fdd102ae149e87fe20b8b868982e15d'),
    (('public', 'communication_routes', 'gridex_perf_authenticated_select_v1'),'e240d58e3c8e83351133ccfb78d735eb4f8662eb147f49aa4ecc9a9943846189'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_1806e22fff8941467569'),'96cf9c543ef2a0dfde2e7da7ba5756d91060e96e1f13d8465873d2ba77ab1c7b'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_78008b0a0b618506967e'),'3076e4a5540944016961063b867b4bdcbbdc7f28dded3ebb759c7f25a5cda478'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_8f2b4f6dcb09413c07a8'),'13029e53a851e16ba89a59de08bf5d6caa45171e39f26bd63463f14fcc8a97d7'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_ad65effe5c65240f6217'),'66b24fbc07c51c0ee0357c7a262b34a53ed0a4965f477ef9ff6f74347ec7bd17'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_e59439a629a8c0e6b6fe'),'2aaae8985c9642ee8053ed5c3d0ddbfc5514a17f3b4b62b5c8d255d974b137d3'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_f57cfab4dc9a92fe7525'),'84f99fa1b8b187962d26c520b431489a76abfa4dde9c36038995ba0ff7ff8a8a'),
    (('public', 'company_customer_number_sequences', 'gridex_mp_f639e065fa5f86475ac4'),'337cc6a6bf6f70cf5d511a86267c530ee4e5f142b469b4266e9c6d8f5b874339'),
    (('public', 'company_customer_number_sequences', 'gridex_perf_authenticated_select_v1'),'d28c02075d0dfc3e4db612c2cc81b7e67a33f6aa34a417b8ab01e8e21b8629f4'),
    (('public', 'company_invitations', 'gridex_mp_00568abf200ff3564403'),'d0c9c8e5a5b4f4e6c836016a6032a289ebcf29318902c9f8fa360a46fd5493ad'),
    (('public', 'company_invitations', 'gridex_mp_2a597f77b183f20e38eb'),'18f905571729f74e9435c5244f27aab5c97a4ebdceab7e5e8b0e65d119ff7df2'),
    (('public', 'company_invitations', 'gridex_mp_4100e1f7d44437b08fc7'),'ad65b737b75efe4c54cb9ff929ba5dba9ff1a2202a4b0fb9fae6248cccee5390'),
    (('public', 'company_invitations', 'gridex_mp_44449f02ed77af7e7d6e'),'a1d7d646a4f13253e10f89bbded65f2485465bd478e29696b78a26b4afed0be4'),
    (('public', 'company_invitations', 'gridex_mp_5c8a5e2da5d66e18c66c'),'ebbc74a142db32d77a67d3417d00fb740757eaf411123de64ed4c1aa2b006e37'),
    (('public', 'company_invitations', 'gridex_mp_95994347788240807258'),'4aa7bdaaf4d1f9c11b662a03ceef90e1482062f499f077b8e7c0b6d842671813'),
    (('public', 'company_invitations', 'gridex_mp_a55a32b0859449413517'),'18b0b1a7238ba3a020b882fed47db65ce69054d0f34434bf0a9571aced43eced'),
    (('public', 'company_invitations', 'gridex_perf_authenticated_select_v1'),'3d21dfd40beb5983a5c3a8756775f3c876fc1ea853b11f96ad29fb4acc754ec2'),
    (('public', 'customer_addresses', 'gridex_mp_1f934487828f7347c978'),'809d2a6a69dfeeb51c6beb9b58d57a85a2d09ab4b647824d52d011dff306d5ca'),
    (('public', 'customer_addresses', 'gridex_mp_2f5a47f39495e27b673c'),'a7e85d209960b2d50a51e757984854ad7c491163806a3a816a30499650314a04'),
    (('public', 'customer_addresses', 'gridex_mp_a6e87b6cdcbfc855e25e'),'4acfc49c211bd7040d6d1d0431cafa7ac7775f94a25326b98bb7fe2a48a079c0'),
    (('public', 'customer_addresses', 'gridex_mp_c12f5b6c418cfb859005'),'dfb7e625ea7f4b1d6a07d355ac0968241dd4d9e2894f6c098cf6f579b4f34157'),
    (('public', 'customer_addresses', 'gridex_mp_c4f1e1ea91c96c927b48'),'57970bdbdec93be43e596c52ff4e1d1899518f455b6c4c2ed63e17033e024585'),
    (('public', 'customer_addresses', 'gridex_mp_da053eddfc63c1160c87'),'b89b061c99f1e115a5b0163c39a1b246702736b101ce2aa38e9d2a9fbfc3daff'),
    (('public', 'customer_addresses', 'gridex_mp_e3cec7e7c79273a286fe'),'88516e2f269e166530f548ecbe1ef9d5fbaf9c0265147f8e5e942a1cd56be6aa'),
    (('public', 'customer_addresses', 'gridex_perf_authenticated_select_v1'),'c6c17d2e089753f1986a8000eac20c96b6fbe6197f811a2c3a32ba98a4858d8e'),
    (('public', 'customer_authorization_documents', 'gridex_mp_1d593b44e4e0b65447f0'),'a09b10de76afdad3b984ac21da36f5b6c095b161e573eb691f6bbaebd23b0ab7'),
    (('public', 'customer_authorization_documents', 'gridex_mp_5868cf8f256e939ad52f'),'76d0f1f6b83253549c2798405252a44126d4d64a436f7d566abf84e74d80f895'),
    (('public', 'customer_authorization_documents', 'gridex_mp_85b2871a836ef219fcb5'),'e29cc16bf4579a856faf764ac4ae1ef3c107c5e265a975b8f3c87c33ee9909dd'),
    (('public', 'customer_authorization_documents', 'gridex_mp_cf754652749fdb787cd5'),'a325559dd9975013bc2c3f7b5c90bb5159ad1f072faa30d2b9d5d1fb9f8eaa50'),
    (('public', 'customer_authorization_documents', 'gridex_mp_def1fd0980835993f727'),'8cbfc85b0f5930e959fb1f696cbfcbfac6a510cbe9df5a58589f45618e0c7e9b'),
    (('public', 'customer_authorization_documents', 'gridex_mp_e7abd844eea07efcc87c'),'8e0e834766171238bef8268cb3af3d405ea414869aabc46b704190fd9a953de8'),
    (('public', 'customer_authorization_documents', 'gridex_mp_e9c353e5b0450b428044'),'5c4025609d3644753a99171b5dee305fc747046203185029c8f864184393c61d'),
    (('public', 'customer_authorization_documents', 'gridex_perf_authenticated_select_v1'),'f0d045836b782fb0b25cdd114c62be077bf75a0de36b51cd12619f6b7dee0b89'),
    (('public', 'customer_contacts', 'gridex_mp_270875e31c4d1babd33d'),'da01460a8d687743db1607f3a2cf55c28626ecd803aa5ca61465281960393cf4'),
    (('public', 'customer_contacts', 'gridex_mp_49cbb82bb9ef2f4b7bc6'),'e0ea038654b835ff0b0114948ff9778a9152d96b2e1c5c32f83f7aa38c210a6f'),
    (('public', 'customer_contacts', 'gridex_mp_4ef3d7066347e1f2ed8a'),'f332fdb2c4e5d88648cc6d9bcb9e34f716b5c78a8ebdd6fe7a0ee5a3b10c97c5'),
    (('public', 'customer_contacts', 'gridex_mp_5c26022d271ea388f015'),'54a0271b363eaaea164fe3462d875469db69b05bf10683348751ce6955703f18'),
    (('public', 'customer_contacts', 'gridex_mp_b362f5f9aa9eddc827e3'),'eefa69dd8c473254248592eb2af88eaa464bfc088d610d215bc34e9d54f82e74'),
    (('public', 'customer_contacts', 'gridex_mp_e34b844ab36871c50801'),'5e9bb7284b88bc931cfb93cd5ea0db1c2f9698846bd60e3242edaa588109e273'),
    (('public', 'customer_contacts', 'gridex_mp_ee17dfaa3bf7e3935970'),'930de27878ce9db048cb24f772e416be2b79440eddb4194ca3ab1488c4db3933'),
    (('public', 'customer_contacts', 'gridex_perf_authenticated_select_v1'),'dc27337d5bfa0065b1eb6cdc68413368a68349f661d6423ee3cc578703d7c110'),
    (('public', 'customer_contract_events', 'gridex_mp_35a3ddf716895891e4d6'),'14282ea855d529574b8382fcc8e6201bf6c09d20742b85e6315cc5e0dab1af08'),
    (('public', 'customer_contract_events', 'gridex_mp_4bcb3c281e941fdcf3e5'),'4ba24959bf4607ac5b7e1489dc301fc1832f53378fb2c923250172112f35d298'),
    (('public', 'customer_contract_events', 'gridex_mp_5b6b24da4796a6585646'),'7e402400fb9442476d59c8fce0e48a2616e1e1d382ac7171a7ed548e172343df'),
    (('public', 'customer_contract_events', 'gridex_mp_719481b1117f6010381f'),'1c7075978c260e5f7e35d7a0d92a34edac84384c6d30c0886934c15eff73d121'),
    (('public', 'customer_contract_events', 'gridex_mp_afeb39fc1b9ed120aac3'),'2160479b538d18d1fe745ecbd6ec7ad9b17830de391db81234fea38f8bdd7c4a'),
    (('public', 'customer_contract_events', 'gridex_mp_bbd32d16dab17f7c0ba6'),'2d7245653835bb12af223f1d69f5207b6cf05f51b5994383753dca090f2d51fb'),
    (('public', 'customer_contract_events', 'gridex_mp_f3594b5d9820ef18b258'),'310976cf4fb5ac36a821937755fcdc150e1f2f4f08970a4dbb6be167fe444472'),
    (('public', 'customer_contract_events', 'gridex_perf_authenticated_select_v1'),'1fd38163e856bd8a889fb44bb33f5eaa8f4c7dd0db3562b79f446d548501a4c5'),
    (('public', 'customer_documents', 'gridex_mp_0073cf03fb4f4ce5e3f0'),'49d10215a5e2865f89afa2c9a8db38eaa8bdadac91d18d82c31dd08b097e5ea4'),
    (('public', 'customer_documents', 'gridex_mp_0f2d75395a9ca26ff3df'),'aaae27c71a56345bc66c4830349d746aa35bbd85e466fd0163f9f945aecdc9aa'),
    (('public', 'customer_documents', 'gridex_mp_200d1d31853116f12072'),'b6e484fbfab4fa31424434b0d5f94981bbdba6647ac45bc70082ff81f19d03eb'),
    (('public', 'customer_documents', 'gridex_mp_690a3578ae14921cbf6a'),'37951d07e533411e91c4d788cf33a209dd831f0e9ca1001c215fee217da60915'),
    (('public', 'customer_documents', 'gridex_mp_744d9300f97d985318f9'),'c17828398c95e1b2f350800a2a1404d9a7d3f29b10daa1562d0d7887dd3792b2'),
    (('public', 'customer_documents', 'gridex_mp_a0f2cbd6aa7f33827796'),'51aba851e1a198c4e760c85e413c883b6cff20755cc7f03c30af937a385548fa'),
    (('public', 'customer_documents', 'gridex_mp_cf5c7b2b75f1a90dea66'),'6b7ad4f313889104e26d3b928d9ab0f792fa00883912bb4167c6a7696ea01c9b'),
    (('public', 'customer_documents', 'gridex_perf_authenticated_select_v1'),'483ffd87b5c62a880942e4d443634a08f3d5a139f9f90d773f702b1a1dc51788'),
    (('public', 'customer_info_request_events', 'gridex_mp_048991d688cba9f83bca'),'66bf71d4de5fd1c6a62bafc29c0967186f9137fdde26e23431f9f55aaa3960ba'),
    (('public', 'customer_info_request_events', 'gridex_mp_15ad63abaaf651b35bd7'),'15e1a46c27c37a60f940f6d9332c67b52ac01e921472a9ba6930880a0734eef0'),
    (('public', 'customer_info_request_events', 'gridex_mp_5aede207f5fa533f44df'),'5ae42e880bfba9e0c6537e429cef7915f64ae59c7657ae9c58608610de540d38'),
    (('public', 'customer_info_request_events', 'gridex_mp_73114b6f8226a07cb343'),'3d5224c8fd56638e58196bba0e4b3385a71f843451b1f2928978220c7c520d08'),
    (('public', 'customer_info_request_events', 'gridex_mp_caa97c7ac48515e4cf02'),'2e77c0aeb779c60dab0a78ef5076a269380febf99ac89a5a01e05d3d79a133cf'),
    (('public', 'customer_info_request_events', 'gridex_mp_ec8eedee9370dea61c31'),'aa5da4b7656c1172f108909dd67b24ccb3325ebd02cddea458067cb3b45abaf8'),
    (('public', 'customer_info_request_events', 'gridex_mp_f625bcbc0cffb824de0e'),'fbac14f4bad4b43b0ff1b7eebf29741584e481b644de48482f0606ed0af0acc6'),
    (('public', 'customer_info_request_events', 'gridex_perf_authenticated_select_v1'),'053e63723c2b5dc44ca6eddf575fa7c1bedcbc6db2810e3425b0c3654185abce'),
    (('public', 'customer_internal_notes', 'gridex_mp_3ddc20499656d5c17297'),'5ff2866c63c89a5aad242aa068f17ae8effe954398b0d1b629fd00dd4fd2c89e'),
    (('public', 'customer_internal_notes', 'gridex_mp_5cf8df6a58aab469bfd7'),'2bd77d4b5db4500ef49abda0edbdcdd0e6b639d2b9391b37d432aa39ccbb6cde'),
    (('public', 'customer_internal_notes', 'gridex_mp_bafc57c78c71919f52da'),'81fb4d757626f8d2073b9c66d5a2654c6507b21abbb313efe225595bbfa2e02f'),
    (('public', 'customer_internal_notes', 'gridex_mp_be5f6971559d176aaad8'),'aa2ff99f5a6f099a711339841585c2d1b08ff98b43b49fc4eb35a3f300fb632c'),
    (('public', 'customer_internal_notes', 'gridex_mp_cbf81fb33c3dd4c3b6ce'),'8d1ec876f8d40b299a0a4cd99878aa6ddabfcc2b204509007a581946042ae2da'),
    (('public', 'customer_internal_notes', 'gridex_mp_db3eb69eabdb8d5967f3'),'710140dea12d2cb109eca173a0a2bbda452076d1d8107be7995250feb5b5232d'),
    (('public', 'customer_internal_notes', 'gridex_mp_e0d6e8056ba8f8dd9b8c'),'a6e702970639ade6f93c3e1d13c4d26f1cc793acfed494443eeef8114a2c5bc5'),
    (('public', 'customer_internal_notes', 'gridex_perf_authenticated_select_v1'),'9a430555386b1f6f04e06abe5640ef9cb5ae6f5c685dfa1fd7447acb4eb8257a'),
    (('public', 'customer_operation_tasks', 'gridex_mp_09abc83095708f13780a'),'e5626aede5d4b0d647015b881ecba554b22162c385014962d50bc0dd8fe6d1f3'),
    (('public', 'customer_operation_tasks', 'gridex_mp_2fd0d2abd84503796122'),'01862d751f17ec616e07e3c42c17cc247f64444783a006d48907e484f2de6e1f'),
    (('public', 'customer_operation_tasks', 'gridex_mp_77484d3eccbc7c950468'),'e8f3d579cc616f7617cd0d64def823ba2f6303fdb731ad90e5c6ba98110607f1'),
    (('public', 'customer_operation_tasks', 'gridex_mp_b4194c91f447862e4c7e'),'f27eb36212bf110660cfed94835344f373a263005f2372bc4befc0abb8051920'),
    (('public', 'customer_operation_tasks', 'gridex_mp_ba822806184f6afc0d7b'),'270832f2a22c36dd306afef540e63ec56133e10de049228f662ca35059b97b76'),
    (('public', 'customer_operation_tasks', 'gridex_mp_d3e387d866e2ec74a638'),'47b974b271208022fcdfb9a40b763ff231fc5746a1c02442bf4cd820cd5e2ba1'),
    (('public', 'customer_operation_tasks', 'gridex_mp_de72ba51a19d049d3ff1'),'50b9d32249501c470de22ae98557729ff0635884f8b352107fc5a1cc4b124bf4'),
    (('public', 'customer_operation_tasks', 'gridex_perf_authenticated_select_v1'),'5d6ac822cfc111bef78ec63bca222dc5f04359da5d2ec69e53f079bb6d9cacb7'),
    (('public', 'ediel_actor_settings', 'gridex_mp_0d557b09ab0e9c71d795'),'0396065655ea67fb039b16622692d02f22241fda06ca70ac7878cf143decfb6c'),
    (('public', 'ediel_actor_settings', 'gridex_mp_8edea092ed10ffc6d79a'),'355edc7a9461f6283d10243f747a52c5027d947c95025d252d94219f7135ccf9'),
    (('public', 'ediel_actor_settings', 'gridex_mp_c4ab4a1fbf80131385eb'),'df57f8323bffdeb1c5e76937910a144251666e808d62e25f3afaf9deba991147'),
    (('public', 'ediel_actor_settings', 'gridex_mp_cab292ed7c776394f0dd'),'004b1f731639e149f2456a53f7753b64798b88016b14f6fb2f25ca1ce4527286'),
    (('public', 'ediel_actor_settings', 'gridex_mp_e80782e1ebffe1bb59ed'),'cf33cea9b483233f01c00dd1286bb3bbdd1220059b909672331a327afaf30efd'),
    (('public', 'ediel_actor_settings', 'gridex_perf_authenticated_select_v1'),'ab4f22c9ca1a61326f6f58693c7a7fd30a60536efcaa26230df629a55dca5148'),
    (('public', 'ediel_route_profiles', 'gridex_mp_373d410987a61140e901'),'d8bbeec11f41cee19606634daa76e71410ee4427011e657d29a346ae0ee0d35e'),
    (('public', 'ediel_route_profiles', 'gridex_mp_50a8812bf4123b7cfb8f'),'a532b20c44973024010230cb2ec32f413cd3cbafd41d642651c70894facc7c64'),
    (('public', 'ediel_route_profiles', 'gridex_mp_8fd20e477ab2a47d421b'),'009788d252ecaa118d552e7f96629feecde808643a175d64dd147698155579ac'),
    (('public', 'ediel_route_profiles', 'gridex_mp_b5d41d4f755380bea178'),'6692e4dcd7d642b8af7aabae35d442b7ef5cb4eaaa4f92db3acfaae458c2d7dc'),
    (('public', 'ediel_route_profiles', 'gridex_mp_ba54c24776262517c51f'),'428433f0848ee5dc028b938d6390ed2e25d34e33a8881baa75a1de31ba1b2cd2'),
    (('public', 'ediel_route_profiles', 'gridex_perf_authenticated_select_v1'),'1155745f7bf3090b6b1e5853e84606b3a890121be4147b4daea0db3437cb4124'),
    (('public', 'ediel_send_locks', 'gridex_mp_1e131afb1c627ab1c137'),'b5a1e286828f7dd4a978958bf7a287cef7996b3f5347ae53a58edb867b799364'),
    (('public', 'ediel_send_locks', 'gridex_mp_4fc7c88588b93b1e8b6f'),'ab884aab91bd11ae84ca1b86f96c9b02a7d7396dc9756043d3a528587aced529'),
    (('public', 'ediel_send_locks', 'gridex_mp_5ff8c67574503aef4326'),'cc5edd209a16a2fe445ac1b382a03007af409f5d943653314537c4d5fa6b3e89'),
    (('public', 'ediel_send_locks', 'gridex_mp_bcd070b1de25e8059f2b'),'5f29e606e490ca11829b0065dd1a12189e1d33172fd3766ac1ae8864eb4e76d1'),
    (('public', 'ediel_send_locks', 'gridex_mp_d31ac6d667cda6f43cf7'),'7d0dbea7e2bf08fd09e865691864f44f988a760a910ddddcaa4633e45f9ec9f2'),
    (('public', 'ediel_send_locks', 'gridex_perf_authenticated_select_v1'),'3828b4087163470d43f1e4feca9d1650e3235040315bb0cd222fb01682a72480'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_0a5e91c2350155525bce'),'421be99613e5484ea05af1ad87d0723a649888f3be274a4c4fcd0506482dec1b'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_0fc9f2c116ff971a6c29'),'adfccec217f391e7d25d7995e7adb94a2e4bb689e2e1ad40c08931b8ae7bb4af'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_3c68c5fbae9693de53a1'),'a4bc9915fc66827588d6c27fe7817bd3aadcd3921fa5800e928edd66cf7b0051'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_41b1cdf7ebf43fce0dbd'),'3d7e768cb417a19bb2605c6f80ffb5223ed97f7cb6ee1a728c08e8d700f33b58'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_cb352b644f465d6ef2a2'),'2199b67fa9cb72725d60978799c0c23bb1429c44e08dd00ce01b46e487ce7073'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_f0872e9b54bb3b580ffc'),'e4d7cf6f957c509b9067ed541b4f29ec5ef737548a1ae22496930a1709d6500c'),
    (('public', 'grid_owner_data_requests', 'gridex_mp_f8c09c5491ae621ccb30'),'85c6c0157ba63e6d2e620c5b204280033f8ac3cbf5665c0d9a97e8b941e397a5'),
    (('public', 'grid_owner_data_requests', 'gridex_perf_authenticated_select_v1'),'b5768a28760e1dfddc3977c5364552d67ca3115c6b48a65c043749b3fddde8b3'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_0c663c355c5875976100'),'17c1d3e25df707ab1c8942d01436d49de456486b9d998882b62ea0b920ee9d8b'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_2264cf22bafa4d18966d'),'031c7bcb90d3ef50c432f6fb3c61a2f4f1921c46e14b8497f1a9fa1a1710aee7'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_5a807356abacf0bd0b5e'),'774ecec9347a789b5595cc585d3adab129f141ddaef503a04ece53c539388691'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_5dc1510c62827e574838'),'f8bd7800e23b24fc956216a54deb5ff46b997bdabb08874a802f0603d3e923d7'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_8b0e277f7f99dc2da636'),'1c25c75bcb08a3312072641f046253eb6f123623d71927a621b9f3d4076b0985'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_9ae2fc3ce15dea32bddd'),'cde0000378d3f691a66e0185a1d2f7559b0d320fbe2eea9680d7e8e8d238c2be'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_b311c4127360006b08de'),'80a3b89ebdab5abff34de41d227cfd2885abbd557e9ab6c3c3607c38604f02a6'),
    (('public', 'inbound_processing_jobs', 'gridex_mp_e726eb6973780e3e4461'),'685f488e50ecbaeb91263986ca91b11e6e3a54a2338555f618a9906637910115'),
    (('public', 'metering_permissions', 'gridex_mp_2ec74ad3e1b0cd7abfb6'),'4195d3deb407dca15814a9b150dca1aa68d930c2dbac09f7698aee3306af91b1'),
    (('public', 'metering_permissions', 'gridex_mp_3dbab22a832a1959551c'),'c73fbbcbdaef1e03183bf8f83e76b24196ff1b85c035dadf6f9ac13893b084ff'),
    (('public', 'metering_permissions', 'gridex_mp_59ebea0afaa910af537c'),'a8dcf5a2054e9f61400610a8666c1017b4e1304cfe4e9bbc3aea9bad0c280be2'),
    (('public', 'metering_permissions', 'gridex_mp_96b1a71941f2959cbc25'),'345d111d83dd8947d72f86cbf3f11fa8f7dd7a1a59bc8f1f6d2d092c0fbdd550'),
    (('public', 'metering_permissions', 'gridex_mp_9dfd88c76b34b0469374'),'c5f24e0242b92246ec5db1a2239bf6f0a22bc4242143f335a5c22e347a644535'),
    (('public', 'metering_permissions', 'gridex_mp_b890004c7716d3837802'),'0157d604a43d791c2c9cfe8fa822926765afd12ac5cf32ea2a2857da6097dcd7'),
    (('public', 'metering_permissions', 'gridex_mp_ffefc0639f44789a434f'),'f09657abaa969274abf45e26eabcb2cdb9384211bb1f0f16f21d8f9e869d437c'),
    (('public', 'metering_permissions', 'gridex_perf_authenticated_select_v1'),'589e5976fd82ed8c74a8214cf348bc2daa6ae1066d7710b81124143c9e1142e9'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_4c07aa807632113d80dc'),'6e05eaee0a82238795b699a6a0ce2a76a8497a1ff978a7548f181a6f66015385'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_9fd5712b552e2d605c9f'),'26a1bf43aa7f41d88639e3f4a761f86fbdc766cbb41a386e44c4632ed50a2e0d'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_a92d3537299dcc095964'),'c0e20f0d0fb5e91b1dd21c7960643f354a18439d62c7168fbafaa5f385208f86'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_a9f87e4eb2069d51d217'),'61844e9dbdee48635dacb19a4f2591182a12a17549b0805488b4eef981deae55'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_c26a4133964b2501f782'),'41f9c1974e0a23f9baf5ddaf76f9594459f282ee769921af7905399ad3dcd34f'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_d66a86f24dcc7e750e7d'),'25b4eb146b7f2885a87baf1ed51c8b5ab6af0dcb7f7c0592b6ae5511b24e48af'),
    (('public', 'outbound_dispatch_events', 'gridex_mp_d89fd4682d69a582d5cc'),'efafbadcb30eaac18d32b9f07d16a0380716702fd8b4959d473be6f28bb43c19'),
    (('public', 'outbound_dispatch_events', 'gridex_perf_authenticated_select_v1'),'2a31db33464daee1d24a3e70bc930921dcb08add4efbd3daff075e3a5c72d6c8'),
    (('public', 'outbound_requests', 'gridex_mp_1ce7db6da88a5f81cfc3'),'6bcd63fb4682b39b164e95f84dd68c515ac8a4643b76b16cd2b2757ceb8545b5'),
    (('public', 'outbound_requests', 'gridex_mp_798c4d85497734b4fc68'),'8e996a42037a704c2d44ae61d4f4cf8d0868f5badd956420aaa829b6072dcbaa'),
    (('public', 'outbound_requests', 'gridex_mp_89e69866433be2786426'),'39e9fd39b2c32a3a39fad9afc8be4a388d446bd4a8f01a57261fe1b16c82aaef'),
    (('public', 'outbound_requests', 'gridex_mp_a2af7a43ef808de0d334'),'c69bc3d57c6c2ebaa59f1a7a4b333a8f58ba8014c06231e49a76629b88b3d9f8'),
    (('public', 'outbound_requests', 'gridex_mp_f7d75aa9ec401b6055ba'),'e936c5e0272ac1b01ddb5a6d38c14ef37a0fdc26ec81d6ae53c0e338ad35ea60'),
    (('public', 'outbound_requests', 'gridex_perf_authenticated_select_v1'),'162caa6b18d8c319b3f4b1d78fac131304c39b18c9ecff93d300e47fe86d2d6e'),
    (('public', 'partner_exports', 'gridex_mp_2ba62a3c69180f6641e5'),'a489600a4c96aa6018fd003e11f983252e5fc11e77ce0e447c7ef56ac6d224bd'),
    (('public', 'partner_exports', 'gridex_mp_3c16c585536566780594'),'ee181deddd38df50a265f0753af80ad6e5369f6cb5719781da58a499ae74713f'),
    (('public', 'partner_exports', 'gridex_mp_5c7f097024a6b45a6f89'),'9f9fa07e3724411c1771aa780799590d57c6e485a9abbf1e1865ede78c9525c7'),
    (('public', 'partner_exports', 'gridex_mp_6b8fbc2194343d1a9420'),'b2dda3f48450795a575eb722701267bf4dbe9941de82725bcf2f1f915241ab31'),
    (('public', 'partner_exports', 'gridex_mp_a8b3832738662a80c300'),'8aa46e2d48247ebb855bd9fd30f20e865ffc7e3fac3540fe48706f2c563346bf'),
    (('public', 'partner_exports', 'gridex_mp_b69c73a719ebbcc778fb'),'a9e3a02cbb2ea7a1277824305daa01c4dc96e25699b241b1fac0db334c66c0c9'),
    (('public', 'partner_exports', 'gridex_mp_ddf4ee019a5f394c931b'),'db2909734bbbf5fe70c351edf25f533415988472064150291d55bf8df3384d46'),
    (('public', 'partner_exports', 'gridex_perf_authenticated_select_v1'),'2a98528e6558f18e5da8c4ce3856dc9812a527b0ee4c484d92f232362113b9cd'),
    (('public', 'user_roles', 'gridex_mp_3283aa0a77185b5d7218'),'387dc31b430b2621114109bb3e00853451f166d51d60b93feed5bc7e8749630b'),
    (('public', 'user_roles', 'gridex_mp_389e8aa5f7262aefc4ba'),'a4c0a0c6fcb69d0e0519a662fd5ed0bdb42108092a93990062970b452a22a94b'),
    (('public', 'user_roles', 'gridex_mp_5e33311b5bd05a3c8927'),'7b0a61f0fc997ce4b0bcb59a5635d2ae264eeb0055952f575f3b927aeac6e14d'),
    (('public', 'user_roles', 'gridex_mp_95d525330d80bce236ff'),'de1d2e86726238d57498280049d6cfd59c2aca10d79a686dbbd364a817c5f593'),
    (('public', 'user_roles', 'gridex_mp_b4d9a7b86f07d5647b28'),'a08b06fc59443822c2f9838ffe73ec1f4bbf65ccfbeacc0d665a095035ce94c8'),
    (('public', 'user_roles', 'gridex_mp_d24c3d4921a871181845'),'2a0687e62d088f6fe29f91c53a695a6defc1d30b972e049ad24b084b3a8e0db6'),
    (('public', 'user_roles', 'gridex_perf_authenticated_select_v1'),'5a98141eb2e23a874dde422b1e1aac2a58e0525cecaf42248741a960bb78b64d'),
)
FIRST_FIVE=(('migrations/20260915111458_restore_existing_column_foreign_keys.sql', '5593bf9f66e2ea783ac37f23ca4f547132e70beb519a955dc5b2666a65db569c'), ('migrations/20260915121224_restrict_retained_operational_table_privileges.sql', 'c8928d29f3cf5ad527513a7448b4819c4f7a80f07d9fe3b78c764e30759e134e'), ('migrations/20260915132224_restrict_inbound_service_table_privileges.sql', '0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033'), ('migrations/20260915132227_restrict_new_tenant_table_truncate.sql', 'c67328cde9b270efad94aa44ded06f3b435170f247af90b1ea93e01dfe08523a'), ('migrations/20260915140647_restrict_remaining_rls_table_truncate.sql', 'cf85df9d7339e5368ceac7567b720dfa26cc2bf51fe2cd0f19b79b3af7eaab2b'))
FORMULA_PROOF_SHA='1e1338facb111230aeb95e9ac34bfd8be268a7f11692dcbd02158341d94816e1'
SIXTH_SOURCE='migrations/20260915144319_restrict_ediel_send_lock_client_writes.sql'
SIXTH_SHA='411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705'
SEVENTH_SOURCE='migrations/20260915172543_preserve_retained_customer_history_on_delete.sql'
SEVENTH_SHA='00f8a844fc5c72274d697558d57f216acf56388b6d36f6aad6063ca255283734'


def sha(raw):
    if type(raw) is not bytes:
        raw=json.dumps(raw,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class Retained:
    sql: bytes = field(repr=False)
    register: bytes = field(repr=False)
    evidence: tuple = field(repr=False)


def validate_retained(retained):
    if (type(retained) is not Retained or type(retained.sql) is not bytes
            or sha(retained.sql)!=SOURCE_SHA or type(retained.register) is not bytes
            or sha(retained.register)!=REGISTER_SHA or type(retained.evidence) is not tuple):
        raise ValueError('REMOVED_POLICY_RETAINED_SOURCE_REQUIRED')
    register=json.loads(retained.register)
    expected={r['path']:r['sha256'] for r in [register['referenceSource'],*register['sourceEvidence'].values()]}
    if (len(retained.evidence)!=len(expected) or any(type(x) is not tuple or len(x)!=3 for x in retained.evidence)
            or {(p,h) for p,h,_ in retained.evidence}!=set(expected.items())
            or any(type(raw) is not bytes or sha(raw)!=h for _,h,raw in retained.evidence)):
        raise ValueError('REMOVED_POLICY_RETAINED_SOURCE_REQUIRED')
    return retained


def retain(root):
    root=Path(root)
    def read(name):
        path=root/name
        if path.resolve()!=path or not path.is_file():
            raise ValueError('REMOVED_POLICY_RETAINED_SOURCE_REQUIRED')
        return path.read_bytes()
    try:
        raw=read(REGISTER)
        if sha(raw)!=REGISTER_SHA:raise ValueError('REMOVED_POLICY_RETAINED_SOURCE_REQUIRED')
        register=json.loads(raw)
        expected={r['path']:r['sha256'] for r in [register['referenceSource'],*register['sourceEvidence'].values()]}
        return validate_retained(Retained(read(SOURCE),raw,tuple((p,h,read(p)) for p,h in sorted(expected.items()))))
    except (OSError,KeyError,TypeError):
        raise ValueError('REMOVED_POLICY_RETAINED_SOURCE_REQUIRED') from None


def reference_guard_rows(retained):
    validate_retained(retained)
    reference=dict((p,raw.decode()) for p,_,raw in retained.evidence)['supabase/schema.sql']
    register=json.loads(retained.register)
    removed={tuple(x['identity']) for x in register['records']}
    A='( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)'
    W='gridex_can_write_company(company_id)'
    G='( SELECT gridex_is_current_session_allowed() AS gridex_is_current_session_allowed) AND ('+A+' OR (company_id IN ( SELECT gridex_user_company_ids() AS gridex_user_company_ids)))'
    rows=[]
    for name,table,statement in re.findall(r'^CREATE POLICY (\S+) ON public\.(\S+) ([^\n]+);',reference,re.M):
        if table not in TABLES or ('public',table,name) in removed:continue
        if name.startswith('tenant_lifecycle_'):
            command={'tenant_lifecycle_select_guard':'r','tenant_lifecycle_insert_guard':'a',
                     'tenant_lifecycle_update_guard':'w','tenant_lifecycle_delete_guard':'d'}.get(name)
            if command is None:raise ValueError('REMOVED_POLICY_REFERENCE_GUARD_REQUIRED')
            row=dict(nspname='public',relname=table,polname=name,command=command,permissive=False,
                     roles=['authenticated'],using_expression=G if command=='r' else W if command in ('w','d') else '',
                     check_expression=W if command in ('a','w') else '')
        elif table=='inbound_processing_jobs' and name in (
                'inbound_processing_jobs_platform_select','inbound_processing_jobs_platform_write','inbound_processing_jobs_service_role_all'):
            command='r' if name.endswith('_select') else '*'
            predicate='true' if name.endswith('_all') else 'gridex_user_is_platform_admin()'
            row=dict(nspname='public',relname=table,polname=name,command=command,permissive=True,
                     roles=['service_role'] if name.endswith('_all') else ['PUBLIC'],using_expression=predicate,
                     check_expression='' if command=='r' else predicate)
        else:raise ValueError('REMOVED_POLICY_REFERENCE_GUARD_REQUIRED')
        rows.append(row)
    if len(rows)!=95:raise ValueError('REMOVED_POLICY_REFERENCE_GUARD_REQUIRED')
    return rows


def expected_policies(retained):
    expected={tuple(key):digest for key,digest in ADDED_POLICY_HASHES}
    expected.update({(r['nspname'],r['relname'],r['polname']):sha(r) for r in reference_guard_rows(retained)})
    if len(expected)!=267:raise ValueError('REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED')
    return expected


def require_policy_hashes(actual,expected,*,row_count=None):
    if actual!=expected or (row_count is not None and (type(row_count) is not int or row_count!=len(expected))):
        # Positions are one-based in the sorted, retained expected inventory.
        # Unknown identities and expressions never leave the owned target.
        keys=sorted(expected)
        missing=[i for i,key in enumerate(keys,1) if key not in actual]
        changed=[]
        for i,key in enumerate(keys,1):
            if key in actual and actual[key]!=expected[key]:
                digest=actual[key]
                changed.append(dict(position=i,actualSha256=digest if type(digest) is str
                                    and re.fullmatch('[a-f0-9]{64}',digest) else None))
        print(json.dumps(dict(stage='removed_policy_set_difference',expectedCount=len(expected),
            actualCount=len(actual),rowCount=row_count if type(row_count) is int else None,
            missingCount=len(missing),extraCount=len(actual.keys()-expected.keys()),changedCount=len(changed),
            missingPositions=missing,changed=changed,expectedSetSha256=sha(sorted(expected.items()))),sort_keys=True),flush=True)
        raise ValueError('REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED')


def complete(progress,native):
    from canonical_forward_sources import FORWARD_SOURCES
    foundation='foundationInputsExecuted' if native else 'foundationApplied'
    timestamp='timestampInputsExecuted' if native else 'timestampApplied'
    flags=('executed','noOpRepeatVerified','rowsPreserved') if native else ('executed','positiveAndRepeatVerified','rowsPreserved')
    report=progress.get('forwardSources',{});receipts=report.get('sources',[])
    if (type(progress.get(foundation)) is not int or progress[foundation]!=144
            or type(progress.get(timestamp)) is not int or progress[timestamp]!=514
            or len(FORWARD_SOURCES)!=7 or FORWARD_SOURCES[:5]!=FIRST_FIVE
            or FORWARD_SOURCES[5]!=(SIXTH_SOURCE,SIXTH_SHA)
            or FORWARD_SOURCES[6]!=(SEVENTH_SOURCE,SEVENTH_SHA)
            or report.get('executed') is not True or type(report.get('inputsExecuted')) is not int
            or report['inputsExecuted']!=7 or type(receipts) is not list or len(receipts)!=7
            or any(type(row) is not dict or (row.get('source'),row.get('sourceSha256'))!=pair
                   or any(row.get(flag) is not True for flag in flags) for row,pair in zip(receipts,FORWARD_SOURCES))):
        raise ValueError('REMOVED_POLICY_SEVEN_FORWARD_RECEIPTS_REQUIRED')


def expected_routines(retained):
    reference=dict((p,raw.decode()) for p,_,raw in retained.evidence)['supabase/schema.sql']
    signatures=re.findall(r"  \('([a-z_]+\([^']*\))'\)",retained.sql.decode())
    result={}
    for signature in signatures:
        name=signature.split('(')[0]
        matches=list(re.finditer(r'^CREATE FUNCTION public\.'+name+r'\([^\n]*\) RETURNS [^\n]+\n(.*?)\s+AS (\$[a-zA-Z0-9_]*\$)(.*?)\2;',reference,re.M|re.S))
        if len(matches)!=1:raise ValueError('REMOVED_POLICY_REFERENCE_HELPER_REQUIRED')
        declaration,_,body=matches[0].groups()
        language=re.search(r'LANGUAGE (\w+)',declaration)
        config=[]
        for setting,value in re.findall(r'SET (\w+) TO ([^\n]+)',declaration):
            config.append(setting+'='+', '.join(re.findall(r"'([^']*)'",value)))
        granted=re.findall(r'^GRANT ALL ON FUNCTION public\.'+name+r'\([^\n]*\) TO ([a-z_]+);',reference,re.M)
        expected_grantees=['service_role'] if name.startswith('canonical_') else ['authenticated','service_role']
        if sorted(granted)!=expected_grantees or not re.search(r'^REVOKE ALL ON FUNCTION public\.'+name+r'\([^\n]*\) FROM PUBLIC;',reference,re.M):
            raise ValueError('REMOVED_POLICY_REFERENCE_ROUTINE_ACL_REQUIRED')
        acl=[dict(grantee=role,grantor='postgres',privilege='EXECUTE',grantable=False) for role in expected_grantees]
        result[signature]=dict(prosrc=body,prosecdef='SECURITY DEFINER' in declaration,
            provolatile='i' if 'IMMUTABLE' in declaration else 's' if 'STABLE' in declaration else 'v',
            prokind='f',proconfig=config or None,lanname=language[1],owner='postgres',acl=acl)
    if len(result)!=12:raise ValueError('REMOVED_POLICY_REFERENCE_HELPER_REQUIRED')
    return result


def validate_metadata(metadata,retained):
    keys={'scope','postgres17','readOnly','policies','relations','principals','authority','routines'}
    if (type(metadata) is not dict or set(metadata)!=keys or metadata['scope']!='REMOVED_POLICY_READ_ONLY_METADATA'
            or metadata['postgres17'] is not True or metadata['readOnly'] is not True
            or any(type(metadata[k]) is not list for k in keys-{'scope','postgres17','readOnly'})):
        raise ValueError('REMOVED_POLICY_METADATA_REQUIRED')
    rows=metadata['policies']
    actual={(r['nspname'],r['relname'],r['polname']):sha(r) for r in rows}
    require_policy_hashes(actual,expected_policies(retained),row_count=len(rows))
    expected_relations=[dict(name=t,kind='r',rls=True,force=False,owner='postgres') for t in TABLES]
    if metadata['relations']!=expected_relations:raise ValueError('REMOVED_POLICY_RELATION_SHAPE_REQUIRED')
    principals={p['rolname']:p for p in metadata['principals']}
    if (len(principals)!=len(metadata['principals']) or not {'authenticated','anon','service_role'}<=principals.keys()
            or any(principals[r]['rolsuper'] or principals[r]['rolbypassrls'] for r in ('authenticated','anon'))
            or not (principals['service_role']['rolsuper'] or principals['service_role']['rolbypassrls'])):
        raise ValueError('REMOVED_POLICY_ROLE_GRAPH_REQUIRED')
    # Neither SET-only nor inherited authority may enlarge client capabilities.
    for p in principals.values():
        if (p['authenticated_member'] or p['anon_member'] or p['unreviewed_login_member']) and (p['rolsuper'] or p['rolbypassrls']):
            raise ValueError('REMOVED_POLICY_ROLE_GRAPH_REQUIRED')
        if p['rolname']!='service_role' and not p['rolsuper'] and not p['rolbypassrls'] and p['service_usage']:
            raise ValueError('REMOVED_POLICY_ROLE_GRAPH_REQUIRED')
    authority={(a['name'],a['rolname']):a for a in metadata['authority']}
    if len(authority)!=len(TABLES)*len(principals) or len(authority)!=len(metadata['authority']):
        raise ValueError('REMOVED_POLICY_AUTHORITY_SET_REQUIRED')
    all_privileges={'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'}
    anon_tables={'auth_email_events','company_customer_number_sequences','inbound_processing_jobs'}
    auth_denied={'company_invitations','user_roles','ediel_send_locks'}
    def permissions(a):return set(a['table_privileges'])|set(a['column_privileges'])
    for (table,role),a in authority.items():
        if table not in TABLES or role not in principals:raise ValueError('REMOVED_POLICY_AUTHORITY_SET_REQUIRED')
        p=principals[role];privileges=permissions(a)
        if not privileges<=all_privileges:raise ValueError('REMOVED_POLICY_AUTHORITY_SET_REQUIRED')
        if p['authenticated_member']:
            denied=all_privileges-{'SELECT'} if table=='ediel_send_locks' else {'INSERT','UPDATE','DELETE'} if table in auth_denied else set()
            if a['owner_member'] or privileges&denied:
                raise ValueError('REMOVED_POLICY_CLIENT_ACL_REQUIRED')
        if table in anon_tables and (p['anon_member'] or p['anon_descendant']) and not p['rolsuper'] and not p['rolbypassrls']:
            if a['owner_member'] or privileges:raise ValueError('REMOVED_POLICY_ANON_CLOSED_REQUIRED')
        # PUBLIC compiler expansion is finite. Unexpected non-bypass principals
        # with login/PostgREST SET-role entry and independent access need a separate
        # source decision. Unreachable NOLOGIN predefined capability roles are
        # not clients; their authority still fails if inherited by a client.
        if role not in ('authenticated','anon','service_role') and not p['rolsuper'] and not p['rolbypassrls'] and p['client_entry'] and (privileges or a['owner_member']):
            raise ValueError('REMOVED_POLICY_UNREVIEWED_PRINCIPAL_REQUIRED')
        if role=='authenticated' and table not in anon_tables:
            if 'SELECT' not in a['table_privileges']:raise ValueError('REMOVED_POLICY_CLIENT_READ_REQUIRED')
            if table not in auth_denied and not {'INSERT','UPDATE'}<=set(a['table_privileges']):
                raise ValueError('REMOVED_POLICY_CLIENT_WRITE_REQUIRED')
        if role=='service_role' and not {'SELECT','INSERT','UPDATE','DELETE'}<=set(a['table_privileges']):
            raise ValueError('REMOVED_POLICY_SERVICE_ACL_REQUIRED')
    expected=expected_routines(retained)
    routines={r['signature']:r for r in metadata['routines']}
    if set(routines)!=set(expected) or len(routines)!=len(metadata['routines']):
        raise ValueError('REMOVED_POLICY_HELPER_SET_REQUIRED')
    for signature,row in routines.items():
        actual={k:v for k,v in row.items() if k not in ('signature','executable_by')}
        if actual!=expected[signature]:raise ValueError('REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED')
        executable=set(row['executable_by'])
        if signature.startswith('canonical_'):
            if 'service_role' not in executable or any(p['authenticated_member'] and r in executable for r,p in principals.items()) or 'anon' in executable:
                raise ValueError('REMOVED_POLICY_CANONICAL_RPC_ACL_REQUIRED')
        elif 'authenticated' not in executable:
            raise ValueError('REMOVED_POLICY_HELPER_EXECUTE_REQUIRED')
    return dict(policyContextSha256=sha(rows),roleAndAclContextSha256=sha({k:metadata[k] for k in ('relations','principals','authority')}),
                helperAndRpcContextSha256=sha(metadata['routines']),policyCount=267,relationCount=23,
                anonymousClosedTables=3,directInsertUpdateDeleteDeniedTables=3,sendLockNonSelectPrivilegesDenied=7,
                helperBodiesVerified=6,canonicalRpcMetadataVerified=6,canonicalRpcBusinessBehaviorVerified=False)


# Only reviewed constant invariant names may leave the owned replay. Never emit
# exception strings, SQL, metadata, identifiers, or arbitrary prefix matches.
_FAILURE_REASONS=frozenset((
    'REMOVED_POLICY_ANON_CLOSED_REQUIRED',
    'REMOVED_POLICY_AUTHORITY_SET_REQUIRED',
    'REMOVED_POLICY_CANONICAL_RPC_ACL_REQUIRED',
    'REMOVED_POLICY_CLIENT_ACL_REQUIRED',
    'REMOVED_POLICY_CLIENT_READ_REQUIRED',
    'REMOVED_POLICY_CLIENT_WRITE_REQUIRED',
    'REMOVED_POLICY_CURRENT_ACTOR_CONTEXT_REQUIRED',
    'REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED',
    'REMOVED_POLICY_EXECUTION_RECEIPT_REQUIRED',
    'REMOVED_POLICY_FORMULA_ACL_ONLY_ROW_REQUIRED',
    'REMOVED_POLICY_FORMULA_AST_REQUIRED',
    'REMOVED_POLICY_FORMULA_AUTHENTICATED_APPLICABILITY_REQUIRED',
    'REMOVED_POLICY_FORMULA_BOOLEAN_VALUE_REQUIRED',
    'REMOVED_POLICY_FORMULA_DUPLICATE_OR_MIXED_RELATION',
    'REMOVED_POLICY_FORMULA_EFFECTIVE_MISMATCH_CHECK',
    'REMOVED_POLICY_FORMULA_EFFECTIVE_MISMATCH_USING',
    'REMOVED_POLICY_FORMULA_EXPRESSION_REQUIRED',
    'REMOVED_POLICY_FORMULA_EXPRESSION_TOO_COMPLEX',
    'REMOVED_POLICY_FORMULA_INSERT_USING_FORBIDDEN',
    'REMOVED_POLICY_FORMULA_MALFORMED_SQL',
    'REMOVED_POLICY_FORMULA_MODE_COMMAND_REQUIRED',
    'REMOVED_POLICY_FORMULA_PERMISSIVE_ENVELOPE_MISMATCH_CHECK',
    'REMOVED_POLICY_FORMULA_PERMISSIVE_ENVELOPE_MISMATCH_USING',
    'REMOVED_POLICY_FORMULA_PERMISSIVE_POLICY_REQUIRED',
    'REMOVED_POLICY_FORMULA_READ_DELETE_CHECK_FORBIDDEN',
    'REMOVED_POLICY_FORMULA_REGISTER_FULL_ROW_HASH',
    'REMOVED_POLICY_FORMULA_REGISTER_HASH',
    'REMOVED_POLICY_FORMULA_REGISTER_IDENTITY',
    'REMOVED_POLICY_FORMULA_REGISTER_INVENTORY',
    'REMOVED_POLICY_FORMULA_REGISTER_PARTITION',
    'REMOVED_POLICY_FORMULA_REGISTER_REQUIRED',
    'REMOVED_POLICY_FORMULA_REGISTER_ROW_METADATA',
    'REMOVED_POLICY_FORMULA_REGISTER_ROW_REQUIRED',
    'REMOVED_POLICY_FORMULA_RESTRICTIVE_GUARD_MISMATCH_CHECK',
    'REMOVED_POLICY_FORMULA_RESTRICTIVE_GUARD_MISMATCH_USING',
    'REMOVED_POLICY_FORMULA_RESTRICTIVE_GUARD_REQUIRED',
    'REMOVED_POLICY_FORMULA_ROWS_REQUIRED',
    'REMOVED_POLICY_FORMULA_ROW_EXPRESSION',
    'REMOVED_POLICY_FORMULA_ROW_IDENTITY',
    'REMOVED_POLICY_FORMULA_ROW_METADATA',
    'REMOVED_POLICY_FORMULA_ROW_SERIALIZATION',
    'REMOVED_POLICY_FORMULA_ROW_SHAPE',
    'REMOVED_POLICY_FORMULA_UNKNOWN_SQL',
    'REMOVED_POLICY_HELPER_EXECUTE_REQUIRED',
    'REMOVED_POLICY_HELPER_SET_REQUIRED',
    'REMOVED_POLICY_METADATA_REQUIRED',
    'REMOVED_POLICY_QUALIFIED_SERVICE_BYPASS_REQUIRED',
    'REMOVED_POLICY_REFERENCE_GUARD_REQUIRED',
    'REMOVED_POLICY_REFERENCE_HELPER_REQUIRED',
    'REMOVED_POLICY_REFERENCE_ROUTINE_ACL_REQUIRED',
    'REMOVED_POLICY_RELATION_SHAPE_REQUIRED',
    'REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED',
    'REMOVED_POLICY_RETAINED_SOURCE_REQUIRED',
    'REMOVED_POLICY_ROLE_GRAPH_REQUIRED',
    'REMOVED_POLICY_SERVICE_ACL_REQUIRED',
    'REMOVED_POLICY_SEVEN_FORWARD_RECEIPTS_REQUIRED',
    'REMOVED_POLICY_STATE_PRESERVATION_REQUIRED',
    'REMOVED_POLICY_UNREVIEWED_PRINCIPAL_REQUIRED',
))


def execute(target,retained,progress,actor_receipt):
    try:
        return _execute(target,retained,progress,actor_receipt)
    except Exception as error:
        reason='UNCLASSIFIED'
        if (type(error) is ValueError and len(error.args)==1
                and type(error.args[0]) is str and error.args[0] in _FAILURE_REASONS):
            reason=error.args[0]
        print(json.dumps(dict(stage='removed_policy_failure',reason=reason),sort_keys=True),flush=True)
        raise


def _execute(target,retained,progress,actor_receipt):
    retained=validate_retained(retained)
    database,native=actors._admit(target)
    complete(progress,native)
    actors.validate_execution_receipt(actor_receipt,native=native)
    if actor_receipt.get('servicePolicyMode')!='bypass':raise ValueError('REMOVED_POLICY_QUALIFIED_SERVICE_BYPASS_REQUIRED')
    before=actors._snapshot(target,database,native)
    if actors._policy_context(target,database)!=actor_receipt['completePolicyContextSha256']:
        raise ValueError('REMOVED_POLICY_CURRENT_ACTOR_CONTEXT_REQUIRED')
    metadata=json.loads(target.sql(database,retained.sql.decode(),'removed_policy_metadata',transaction=False))
    result=validate_metadata(metadata,retained)
    from canonical_removed_policy_formulas import prove_replacements,prove_component
    proof=prove_replacements(json.loads(retained.register))
    principals={p['rolname']:p for p in metadata['principals']}
    applicable=lambda row: 'PUBLIC' in row['roles'] or any(principals[role]['authenticated_usage'] for role in row['roles'])
    compositions=[]
    for table in sorted({x['identity'][1] for x in json.loads(retained.register)['replacementPolicies']}):
        rows=[r for r in metadata['policies'] if r['relname']==table and applicable(r)]
        compositions.append(prove_component(rows,'r','tenant_read'))
        if table in ('company_invitations','user_roles','ediel_send_locks'):continue  # separately proved actual ACL denial
        compositions.append(prove_component(rows,'a','tenant_write'))
        compositions.append(prove_component(rows,'w','tenant_write'))
        if table=='customer_info_request_events':compositions.append(prove_component(rows,'d','service_only'))
    actors._admit(target)
    if actors._snapshot(target,database,native)!=before:
        raise ValueError('REMOVED_POLICY_STATE_PRESERVATION_REQUIRED')
    receipt=dict(scope='SOURCE_FORMULAS_AND_LIVE_METADATA_NOT_BUSINESS_DML',verified=True,
        source=SOURCE,sourceSha256=SOURCE_SHA,registerSha256=REGISTER_SHA,**result,
        removedPolicyCount=59,replacementPolicyCount=59,reconstructedReplacementRows=57,
        formulaProofSha256=sha(proof),formulaRowsProved=57,formulaComponentsProved=75,
        compositionProofSha256=sha(compositions),compositionCount=len(compositions),
        reusedActorReceiptSha256=sha(actor_receipt),reusedActorCoverage='REAL_HELPER_TRUTH_ONLY_NOT_NEW_POLICY_IDENTITIES',
        fullSevenForwardReceiptsVerified=True,catalogAndRowsPreserved=True,nativeTarget=native,
        businessGraphAccepted=False,schemaAccepted=False,generatedTypesVerified=False,ledgerProvenanceAccepted=False)

    return validate_execution_receipt(receipt,native=native)


def receipt_contract(*,native):
    """Fixed receipt fields only; live execution must supply context hashes."""
    return dict(scope='SOURCE_FORMULAS_AND_LIVE_METADATA_NOT_BUSINESS_DML',verified=True,
        source=SOURCE,sourceSha256=SOURCE_SHA,registerSha256=REGISTER_SHA,
        policyCount=267,relationCount=23,anonymousClosedTables=3,directInsertUpdateDeleteDeniedTables=3,
        sendLockNonSelectPrivilegesDenied=7,helperBodiesVerified=6,canonicalRpcMetadataVerified=6,
        canonicalRpcBusinessBehaviorVerified=False,removedPolicyCount=59,replacementPolicyCount=59,
        reconstructedReplacementRows=57,formulaProofSha256=FORMULA_PROOF_SHA,formulaRowsProved=57,
        formulaComponentsProved=75,compositionCount=55,
        reusedActorCoverage='REAL_HELPER_TRUTH_ONLY_NOT_NEW_POLICY_IDENTITIES',
        fullSevenForwardReceiptsVerified=True,catalogAndRowsPreserved=True,nativeTarget=native,
        businessGraphAccepted=False,schemaAccepted=False,generatedTypesVerified=False,ledgerProvenanceAccepted=False)


def validate_execution_receipt(receipt,*,native):
    fixed=receipt_contract(native=native)
    hashes={'policyContextSha256','roleAndAclContextSha256','helperAndRpcContextSha256',
            'compositionProofSha256','reusedActorReceiptSha256'}
    if (type(native) is not bool or type(receipt) is not dict or set(receipt)!=set(fixed)|hashes
            or any(type(receipt[k]) is not type(v) or receipt[k]!=v for k,v in fixed.items())
            or any(type(receipt[k]) is not str or not re.fullmatch('[a-f0-9]{64}',receipt[k]) for k in hashes)):
        raise ValueError('REMOVED_POLICY_EXECUTION_RECEIPT_REQUIRED')
    return receipt
