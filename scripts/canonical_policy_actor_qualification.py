"""Fixed policy-expression qualification on an already admitted full replay.

No external connection input. Parent owns full ledger admission and its guards.
Typed synthetic rows exercise retained policy expressions and actual auth helpers;
this does not execute business-table DML or accept schema/types/application graphs.
"""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'scripts/sql/canonical-policy-actor-qualification.sql'
SOURCE_SHA256 = '336e76fcdb4896c92f067750f71aebb60635b253385fb8a42e32bf1a946118f3'
POLICIES = (
    ('billing_export_run_items', 'd', 'gridex_mp_36e1514ae5982ac8511e', 'platform', 'bba372703955ac2437adb4978da5ccba788442b9caff2d633878dba1244a037f'),
    ('billing_export_run_items', 'a', 'gridex_mp_39c7692b64cbd58c10c0', 'tenant', 'f43e10e3ede328d90466ab983594a5bb3b48a69aaf5382c3ac37ca9b587c19e6'),
    ('billing_export_run_items', 'w', 'gridex_mp_d59c429ea016cd6099a4', 'tenant', '7b3364350ae245a2922829442aadd57e5bf5f342509fd1e6b3500e205d949671'),
    ('billing_export_runs', 'w', 'gridex_mp_ba9a6e281d0113b32dfa', 'tenant', 'fa4aa761bcdd88611c320e1cc050b49c74cc560025dde7cc8d6fc1e0419cf034'),
    ('billing_export_runs', 'a', 'gridex_mp_bb18366953887925861a', 'tenant', '7a61faa9937501a7083d796b68c4562e66ea0cd3a459adfe1c62c1d7f8a404ef'),
    ('billing_underlays', 'w', 'gridex_mp_98c416bf579663dbb6c6', 'tenant', '6a2a213c8085c0fda6a5034d553f0fcb84d165501c59532416594cdadd99c638'),
    ('billing_underlays', 'a', 'gridex_mp_c3aee7598effd59bb69f', 'tenant', '1319677d0e081bb258a0954bf0340533e9ce1750a77a9da6377643061ad49980'),
    ('companies', 'w', 'gridex_mp_dfed88a79cae9d173446', 'acl_denied', '3a1af68a2c255f9de4481bd00891d39854463c0b2f682e82b44da834949f433a'),
    ('companies', 'a', 'gridex_mp_fc55b7175c3951acf0a3', 'acl_denied', '4b4fd760d01e71c503b4ae269835b987933fac52e390c8650b6d7002180a6d79'),
    ('company_memberships', 'w', 'gridex_mp_58a0211400ea417d71c4', 'acl_denied', 'd4040e2bc7a6563add2a77318e98e692bd5fc931e66ad308ef3caff9a78c447c'),
    ('company_memberships', 'a', 'gridex_mp_5ad5cf7dfbb2e22fd1d8', 'acl_denied', '7d79572a8a63d52b05167a5a1cc10fc3903f1c24ece381ef05999539e1d3ac96'),
    ('customer_contracts', 'a', 'gridex_mp_3b2ae6804c3c1f2360ec', 'tenant', 'bd524cc91d426e7bf0d7c0b5532919627b4470e4b0f13477708b39cb602002b9'),
    ('customer_contracts', 'w', 'gridex_mp_c489f3d162d8e49f4d42', 'tenant', '79841415dee49b2089ec1cd8d2463c635551bfab842a01d02f0b626ce5bb5351'),
    ('customer_info_requests', 'a', 'gridex_mp_036d7e0c25ac778506a7', 'tenant', 'eacd79d9f9d05ac1f0f9cdf24199d9508fa9bfd1bfbfb1fc1f37b7c5ae55d51c'),
    ('customer_info_requests', 'w', 'gridex_mp_aa351e5f51666345295c', 'tenant', '356a4a51789069a43cfaa709ec0a9482b6a5c1b8c92e5e48ea61c5ddc6652931'),
    ('customer_sites', 'w', 'gridex_mp_94b28a477b4f3605ac8f', 'tenant', '646cd555069c79f88247d2cd073d78248a8143463ba80b8fd890956875781e6a'),
    ('customer_sites', 'a', 'gridex_mp_e41450d799fc948805ab', 'tenant', '25236d8b56ad3868cf27d4aaa275c43a8bf470007c0af147fdb84ec6cbcf4a19'),
    ('customers', 'w', 'gridex_mp_9f70fde0c862614112d2', 'tenant', '145f04e4d7cdf7bdef47fc5ecc41093c322646b11deea7aafaa00c6b57d9b7c7'),
    ('customers', 'a', 'gridex_mp_fafefb8b50aeeb8b1d53', 'tenant', 'b37702767296943e11788cfb156e46f4c0529b89fe39850843c6c5dea1847b44'),
    ('domain_events', 'a', 'gridex_mp_0bcec9548195f9f05c7f', 'service', '549894dca6cca02266d8fef7068fb8c09c2d163f0f7353acf53ae3d5e74343d1'),
    ('domain_events', 'w', 'gridex_mp_5b9a1b5d553ceb0e8576', 'service', '5e1cdedc5e410cfa7ab7e5d0a3e914c527ab43f50b1baca2bd220fa36f5c2d9b'),
    ('domain_events', 'd', 'gridex_mp_b6ea5533a57e54e1457a', 'service', 'b7aeb42e4341901904539ab2d0f50aef716cf9b60b520fd6255b11d6e56e6c35'),
    ('ediel_message_events', 'a', 'gridex_mp_2b5aaae6a5f88afd1b74', 'tenant', 'e4ee4aca8d579a3595f9dda3ff039882382a05a8c038c2e4fb7ed31df2b2bc00'),
    ('ediel_message_events', 'w', 'gridex_mp_8f81fc0a90406e7bb3ba', 'tenant', '01c176d5d402ff90b00836961e687a7f79dc6f578525d6b60f4c218e7a772e31'),
    ('ediel_messages', 'w', 'gridex_mp_7bd821a0c63bef93248d', 'tenant', '3c56fbdf4c5a650a844c4c0819a8d3974ae6fc6953ce05ed72ef4c49e6cb9ba9'),
    ('ediel_messages', 'a', 'gridex_mp_a2f857be40f1e68ceb6e', 'tenant', '2e1f63cc85684c67607cb9d87b403a750f71f8a9fbe5bd8bf02dd56a4812f99b'),
    ('integration_api_clients', 'a', 'gridex_mp_181517a66560cb3a31ec', 'service', '4a30f21bf725a1ce4dae9ca5ed07646cb95db83d4e4bc0786e1bc89a4e3baf56'),
    ('integration_api_clients', 'w', 'gridex_mp_b7f0b8763f55f22c4605', 'service', 'a31899e094c6b83bc85bd0e3c60e33dda4d9e8d99d310de3981b527f06df27b3'),
    ('integration_api_clients', 'd', 'gridex_mp_c356aa39390f794620bd', 'service', 'e220f985a416a6c7982ce2e7531b44864bcef015c527d9780d873e22f3f34505'),
    ('integration_api_requests', 'd', 'gridex_mp_2180a19ce7c5433c21d2', 'service', '160f8407aac806b0dae1f3a940c09bf41373c90d60052a3948fd77bce5aa3cf2'),
    ('integration_api_requests', 'a', 'gridex_mp_4d6485d44d84437e0144', 'service', 'eb12ed809de6bd68f85045e4f912a91883eef9872dc2dc6df49f3f7035ba2ad1'),
    ('integration_api_requests', 'w', 'gridex_mp_5d047929ee49ed9e46f1', 'service', '50dc239a5e84426099459a96549b15495b32ba646ddc7c48054500a0d97c88e8'),
    ('metering_points', 'a', 'gridex_mp_a453fc79e2169d72710a', 'tenant', '1c7191bf4a226702cadde8370cea15c709a55bfcab48543aa42fc029032eaaf4'),
    ('metering_points', 'w', 'gridex_mp_a98f13fb311cdd9153b7', 'tenant', 'ca6385d6a0db79aea394242a7fc714228a520be5ff343fe6ec3eec66868a13cd'),
    ('metering_values', 'w', 'gridex_mp_0f867c6e0aa1ab45af28', 'tenant', 'f4d7a3dc6e4f3d52c7fbe01dbf2c6f4a689379f08ac6cf919d19eb6bacd4fa2b'),
    ('metering_values', 'd', 'gridex_mp_513497b40c59479b4f38', 'platform', '3b8a7c1a0b106f785e8bba83c1512bf24596fac2c0d65faae15bd344e02a0833'),
    ('metering_values', 'a', 'gridex_mp_7459d8d4221467a1bee7', 'tenant', '7f32b9e2f1ff9bf2514a746df3c249f423e47cc6b2ddf6a01948c2118e989420'),
    ('powers_of_attorney', 'a', 'gridex_mp_24851d20c03e49a78e72', 'tenant', '57bbb50398bbc02ddca7ebb1c35dda6bcff401f3ff688be62298b49734d18ad2'),
    ('powers_of_attorney', 'w', 'gridex_mp_f95b28fc8e3f41deb0b5', 'tenant', '4dacb10716bc62ef54889518458c24c9e93de78cfaa683b588f2bb9adf31b302'),
    ('supplier_switch_events', 'd', 'gridex_mp_62dd0779dead0b1e10f5', 'platform', '566f2104bc2ae532c93a9dec17828229ad502cecfed2bd19b0e89523170c40fe'),
    ('supplier_switch_events', 'w', 'gridex_mp_887de2d44e7b19d8912e', 'tenant', 'ab52cb700c163c1269dcfde79c2c47d0421c857f8eb94024104eae166f03ef9e'),
    ('supplier_switch_events', 'a', 'gridex_mp_d5aa89e7d3c29d03e72b', 'tenant', 'be279899a2de25f9d31e776f7fb7db86931821da46906b97b9289101543582d8'),
    ('supplier_switch_requests', 'w', 'gridex_mp_779ccf817e9e70313560', 'tenant', '4b64c9cb3c03eacd0ad4bc72ef2806d1e28d71fc6f1b9363ad49f37daea2ff72'),
    ('supplier_switch_requests', 'a', 'gridex_mp_c8519ae05e83e7829c74', 'tenant', '67ce788fff88250999b7ce4bcdc488a629e989e1d0b1d8469d0a539ac256f874'),
    ('user_permission_overrides', 'a', 'gridex_mp_010d8bdf326d05b94c22', 'tenant', 'cf2e1d59daecfe9b20a76c6ea8d8ec4985f95e674db2c136963722d1906fceb3'),
    ('user_permission_overrides', 'w', 'gridex_mp_275c56e6aea033404306', 'tenant', 'c2f75c1d97f86bb4dc8619afabe18c2d3ca72bdd4a10f5e34ea8f121d6812b0c'),
    ('webhook_deliveries', 'a', 'gridex_mp_a6186c6d84748c343933', 'service', '1f9f88b55493093938df8e12fb83187647928514d1aa57506b9d4adbae2e7ab7'),
    ('webhook_deliveries', 'w', 'gridex_mp_d908d1f170fafa864d90', 'service', '6c8d322b80a0c9c36493cef4027a5be88d4f9b839b9d570057ac60fc784e3811'),
    ('webhook_deliveries', 'd', 'gridex_mp_f5b79b50996a4f74e82f', 'service', 'cb889a98f6b11a4525c256bfcfeb913ea37d0e59c7c1d1a7813cee0cf0a5015d'),
    ('webhook_subscriptions', 'a', 'gridex_mp_9009f6634179599200f4', 'service', '13063ccfe835f06d40dfba6596f704d2bd36d39f61f9712ce55423a8e9d695c2'),
    ('webhook_subscriptions', 'w', 'gridex_mp_95f845fafda898240c89', 'service', '775b033218870c6ca5520c99d80c73252d36a41692790f3c8acee1148111d8bb'),
    ('webhook_subscriptions', 'd', 'gridex_mp_bdd1fa8bf3345f1741d3', 'service', 'd1b139751b8fa6103897a49c1b4b627c7a3efdca39f9451f6318429a25daaf47'),
)


SERVICE_POLICIES = (
    ('billing_export_run_items', 'gridex_mp_272d11caff54b50fd87b', 'f94524493700fdc320ff09faea8864fb8f5ab523edd218b08ebc14e1fd79d144'),
    ('billing_export_run_items', 'gridex_mp_56ee286f3225e52c6dcb', 'd65557b93f140b39e4ece22e511a2286a935eba266b824ae89cb4c1fb1a0e6ef'),
    ('billing_export_run_items', 'gridex_mp_d31aa9ea6551524ab67d', '2cfe50eac57e45ce528f9e92d894010b3251592643c785a4176a82e439233d4e'),
    ('billing_export_run_items', 'gridex_mp_ef4db46263dc082e4575', 'ad0fd2443c220b8093d480685dcca34a3413160fc20313e2202c32aa8ca92efb'),
    ('billing_export_runs', 'gridex_mp_3a3658b8f4a9b1be2fa0', 'ca44cf507dcc33a4e8f726715a26c774312c11280b4737995fc68d03a9648a22'),
    ('billing_export_runs', 'gridex_mp_594ba1ea269e20578a6f', 'b236956f4c2b3904427afef4132ad51624920301dbe92b0b7f795dc3160c1759'),
    ('billing_export_runs', 'gridex_mp_a92d95caf038f235ad0d', 'bbed31bdac2139323fb1f5ce764896e88244abb5f12bfd575a5ab6116f0ab336'),
    ('billing_export_runs', 'gridex_mp_e8d4475f627686737b07', 'a504f6a3165f68e2bcf2607967eed07e89c0d3e580f46c081e4c0cdd9c99a5a5'),
    ('billing_import_batches', 'gridex_mp_04e1b955cda08783426a', 'b78a0255172264eab5fe1f3aa00263dc2a344014b4a2638c568bf9a46a94fd0f'),
    ('billing_import_batches', 'gridex_mp_3a28615c2138b63f131d', '4aa313c4a4b7f8ee49707a9b6d8aeea2ec6b55de5e1168b669801cf3fcc4259a'),
    ('billing_import_batches', 'gridex_mp_4237711f5973ba5b1c44', '6940ada624c156cc141d219ba994db77a760a53032f019f063fa98b215e7cc6c'),
    ('billing_import_batches', 'gridex_mp_76cf71020b9b79fec21f', '328cca388955cb742b3109276bacb0f027d07fd0af74b99948a3e7e47654b006'),
    ('billing_import_rows', 'gridex_mp_3640130084e8e64d571c', '86b8e475fc71476439c7739df3c542323684b462a0f33b65c2bbc19138b3ba52'),
    ('billing_import_rows', 'gridex_mp_5edd73aadb82f0031cc2', 'bd9f339446745c4f9118f08e68bb3acc465dc01d4c05a5c39be06756cacb142d'),
    ('billing_import_rows', 'gridex_mp_89772773851d36ad22f1', 'f7b7d824e57ccad2a027df216614ac213aabf46f28d4a071e05839378de366ed'),
    ('billing_import_rows', 'gridex_mp_d1465ee870d93d91a417', '2420bf3c516afada26e0d8e2adb7a4e7d1245f05593d4d393305fd5276a1bf01'),
    ('billing_underlays', 'gridex_mp_6d134064dfeb024cf146', '6849f7f7b2d3299ec7e132359268bb073866781d5d71e4acd0ab1fb2404082a6'),
    ('billing_underlays', 'gridex_mp_d0a23b23406fc12abc0a', '9f9d6de5da4eb4b160ba487eeb8fa3b1adef632d5886d126c267256867d5a995'),
    ('billing_underlays', 'gridex_mp_f1238cf1607fbe8cc164', '75c882582f253238761d854746c251287992a4c685765c82c867074bd41c856f'),
    ('companies', 'gridex_mp_3e43a389ca086e999072', '8ebaa4fa49108828467d2e16d2ad48c9cceafab0d20acc13bbdd3c9aa250d472'),
    ('companies', 'gridex_mp_8375817cf6ee114e2dc0', '4995f88d5424e1ea8caa0c107b8716c1b7ee29f2194187ea54dc2107d93d096e'),
    ('companies', 'gridex_mp_f38f5d7eaf376691efed', '8bd7dc753f9ecd8c4bd8e146609def5b4b4240c98447817e5214e915f86458db'),
    ('company_memberships', 'gridex_mp_0f75d8387f9b311a1232', 'd174d68e202c619ad4dff1a6ec8584685e24594a9af10a9875a6abd973f6e840'),
    ('company_memberships', 'gridex_mp_1d47812647d6d50abfa0', '525ec1f514d120a3818cd6de5a2f1e02c0cfab3ff146d8ef5fa8169a710d22bc'),
    ('company_memberships', 'gridex_mp_aefb0b5008c562e5c14b', 'ec62337215ea2086df7a5c36dbffb65047c4a1e3ce3fabac1af2da5bf2648c62'),
    ('customer_contracts', 'gridex_mp_5e29c59c997bd0731aa9', '49ec7e605de756d2f33a6c1a67304145588869c908002fd27a53496d5304460c'),
    ('customer_contracts', 'gridex_mp_b9e866773e1b5946e476', '9494a878cb11677afa32867631dec394f489899923fccbd47508d492aaf1ff78'),
    ('customer_contracts', 'gridex_mp_cecd70b22218095bb897', '8c0ae12ca63184376cbaef43f3d6e338139db0d0f7abbb670cbc034be43f56f1'),
    ('customer_info_requests', 'gridex_mp_196760a4b2d4ef65b748', '79abc5c9843af4194ba0b8afcf78de5827b00ea8c244af0ae7615bf5e5c77a3d'),
    ('customer_info_requests', 'gridex_mp_656faa596a4c99bec656', '1030aecf885d479d86d66bf64800acc55178bc5e2ef78e9a47af5ec797cdb306'),
    ('customer_info_requests', 'gridex_mp_ac8de61fc061e50f3a3d', '0fa530a4f3961a819897dfd9e39f47f761217533c3ad0d2fdb7736d0e6699fb4'),
    ('customer_info_requests', 'gridex_mp_b79a4e89f107c77cbbbe', '11fcae80f8e29319764786c45365fe34186f70aab27252c5977ee3ea4270a3cb'),
    ('customer_sites', 'gridex_mp_7af212387d25c3fc5702', '073e4e5fd7c73ae8ccaa95258a1d91a85fb713ed184cea5daa4e370306ff7516'),
    ('customer_sites', 'gridex_mp_e12eb99a28fee9d2798d', 'bb1dd7ef17f6e7533a35975cfa5fe31c7fc81e79931f41bf9a06185f2f0d16ef'),
    ('customer_sites', 'gridex_mp_f9570695458121c7ccff', 'd78f45f71c5a2528d3f92ec9dfba98d0fe66ba06c4e015ea9335531b1781bcae'),
    ('customers', 'gridex_mp_2f07922a7a98cae76d60', '193706704ca3438706c069e20813848e5731a1b2041e3cdce68265ab60a7542e'),
    ('customers', 'gridex_mp_417aff396ae8f545746f', '9f4cde511d03aaebc3ae8aa8cbf38eea0cbde7308da458b0feaf94c4c5dfbba4'),
    ('customers', 'gridex_mp_a5f744341481a057ba49', '27569cf5b1460fc5cf87417b38fd950c429411106ac32655112730fcac0e87b1'),
    ('ediel_message_events', 'gridex_mp_06ed90e240b7406afdaf', '649ec2f21361c76153be9588bd0aa0b48138bd44488a19e174959f844a9c3301'),
    ('ediel_message_events', 'gridex_mp_71746aea63ee7dc59fd4', 'd1c74983603ae4915d513b433bcc0276f1d70cc60cc1f047e2f32f031a3c9872'),
    ('ediel_message_events', 'gridex_mp_fe48f5e50207a46cc0c5', 'bdfa87133f05c6ed47cea5911c8e1b6a8bb10000fa99f5b7448c4ac87e5d0312'),
    ('ediel_messages', 'gridex_mp_25f5ae9b1b728ba7cc8b', '3f9a41198eabfe5b3f723fd735605b038fa76a194b2fc42979605eea72052897'),
    ('ediel_messages', 'gridex_mp_48d4153ddd8be07b99c5', '948fa5d3d2f043ee9fa6931330627d78f524a82bdf51a6dae1025c55ea28c794'),
    ('ediel_messages', 'gridex_mp_82736c4aec9a2b5c4b18', 'b729f53f24f52a9e294a57dc46b88c52dab42cb108188e6d65b0b3a24a13ef6f'),
    ('integration_api_clients', 'gridex_mp_3377a6c54ce85f752628', '8ec71a5b2961a8eff1b2989a48c868eb40fba4d9d0e857cbeacf99443af3b21b'),
    ('integration_api_clients', 'gridex_mp_837e503fb4ed5e53b356', 'd8eff3adfc4e893774aa59f5991e087abf4a588ccc0b52740022fc3b881807ae'),
    ('integration_api_clients', 'gridex_mp_8f8d1b59cb3063524f1f', '0e372241678986ccf65a4f881a5e820ae6cb0139e69d6085eb24fdf36b96503d'),
    ('integration_api_clients', 'gridex_mp_e4736a07282a1588cca2', '19aa8989f03a3390e3cd31215af90276e0e49e9792a6b18f97655c5ba946339e'),
    ('integration_api_requests', 'gridex_mp_1814de05eac768a9431c', '3922f560d67f2b62d095609d335637349682fdd50071ccd84a8ce7fd7d8af6a9'),
    ('integration_api_requests', 'gridex_mp_34a704f1d479be13b06d', '2d49ac3a4e08793fc3082e7f26398e7e7d4204ec7d0f36fc8a29064c8962ac0a'),
    ('integration_api_requests', 'gridex_mp_3d9b8785d4cdf7d9fbc9', '5d278b78148c8b9a935456b290f2088086d553054bd3a1886c2eaae52914fcf9'),
    ('integration_api_requests', 'gridex_mp_ebbfac3259de38e5e497', 'c906c7d67b6973304c96c099f283cba3e37461a4ea829824e391f0fece184a53'),
    ('metering_points', 'gridex_mp_2b582b6d624222a37d35', '4219db244a72e73690725f5b74ba541bc559f79dba21e21fafd5975a70763d40'),
    ('metering_points', 'gridex_mp_b2b2058c0bddb65ed6ae', 'f70262b5d7fe47ff68447d20c77408205d819af23d9fe6cb7f6ea03e4bd75a51'),
    ('metering_points', 'gridex_mp_f18c838347054655c5f1', '972d74c304589d4601d0f9070cd654a5d36f4eb7252c04a6877b49e0b1f59681'),
    ('metering_values', 'gridex_mp_b0bb848d09465e4eb6f1', 'b81ab97b4494384aaddaa287c9af83fd2c969a1847a91f3303d8571586c71f78'),
    ('metering_values', 'gridex_mp_ba82ee77918fc722e2b8', '41e48f46b1b50bcedf1c03a02f02f2a3587eaa1a23e224cc1f034a72bafda2dc'),
    ('metering_values', 'gridex_mp_c0ebb4512308e76e83d7', '00ff4cf91b99b3cc3321fd630e7e64c197c1ef4028a42e933320c2dab8dcc6ff'),
    ('metering_values', 'gridex_mp_e32113a00f03f01a51d7', 'e81d127b510bb53b13139e03bc287398cb796f1da81d008e893f95c685b5a4bc'),
    ('powers_of_attorney', 'gridex_mp_3bc58abc6ac2e7c2dca2', '45048c7f3069c7fee1f53f67ed704f79903d9133d67558832d61578fd0e18b8f'),
    ('powers_of_attorney', 'gridex_mp_74b533756704b3f7d971', '82453320cb6965f7df1073884eaca1f59a23a1f08882eba27b2babb3684d45f2'),
    ('powers_of_attorney', 'gridex_mp_9e0c789e033fff2e438e', '3ff9cf6ddc730b3326400670df44a7c1994c2b8a920f06c99f4820f1670c807c'),
    ('supplier_switch_events', 'gridex_mp_3c28bd33d90b370fcc3d', 'f580c360f35496fed6414d8fbbc4ea1de12c0cced36cfb7e9a3c0e4554242e93'),
    ('supplier_switch_events', 'gridex_mp_6c709f05968e329ffa28', '4d6b503fe641a2637f234a662030c53a88f015b65f9b06c81a588c40b4c6e9f2'),
    ('supplier_switch_events', 'gridex_mp_9e14f3615d2d985997bc', 'ad8c168ff9db3175e9b75ac98312ecf5c892a41b98db7812af876431bb0911d9'),
    ('supplier_switch_events', 'gridex_mp_f9de01877d954ff67716', 'fdafea2809da735e0dc09931d9eb83734123a11289dc270a23931d4b543a2d4d'),
    ('supplier_switch_requests', 'gridex_mp_248261c85c2e88c18d12', '1402e1db5124b022a213cfd031663e97496e6fb046066a8521028eeb7a8f5751'),
    ('supplier_switch_requests', 'gridex_mp_b661dee3e450aa874a7b', '402adb26b1906570c3a0b901d051515459322b710ff2491de1a14030584abc15'),
    ('supplier_switch_requests', 'gridex_mp_de4b4ef296fb8f2d2260', '4759e1575899d554c4d8e94505456248876124e8038dbc1927c008cbf8f5f665'),
    ('user_permission_overrides', 'gridex_mp_8db48f3295d06cfde4c0', '8089b4fa16955553f15bcff551df041d8fdc1793e7953f34593dfdc87fe8ba47'),
    ('user_permission_overrides', 'gridex_mp_f05dd8c187305dd0f42c', '06382a0c5a5f67d52789c195fe480dc4922bab65e55d528bf2e2ec9b6586dff6'),
    ('user_permission_overrides', 'gridex_mp_f6e2038b8dd520929aaa', '07263a95cf23f60b898fa16f7656f4be76c2021432bd24ce19f35a7473f6d989'),
    ('webhook_subscriptions', 'gridex_mp_20952a53bdccf403c6ea', '6404a3478dfb005a8a5dbec2068003e1f061e29cdf1246732f527927f101494c'),
    ('webhook_subscriptions', 'gridex_mp_61a89f96fc15e228d9e5', 'a6a8f55254d73e3a59e33eeec0fad62527b56ee30a4a89c59f68aa8b199d863d'),
    ('webhook_subscriptions', 'gridex_mp_61fa75b827de5883b6de', '87639c01cf0931e02e62493fd89219b8f731d421962749e19cca913971cb8318'),
    ('webhook_subscriptions', 'gridex_mp_afbfa1ccefa6c6bc8e0c', '9dd14ee5973d3e2b3a16551f42f85c12f58991d6c74d4cab67babd7cc02da3c4'),
)


def validate(raw):
    if type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('POLICY_ACTOR_SOURCE_REQUIRED')
    return raw


def retain(root):
    path = Path(root) / SOURCE
    if path.resolve() != path or not path.is_file():
        raise ValueError('POLICY_ACTOR_SOURCE_REQUIRED')
    return validate(path.read_bytes())


def expected_result(service_mode='bypass'):
    return dict(scope='RETAINED_POLICY_EXPRESSIONS_REAL_AUTH_HELPERS', verified=True,
                policyCount=52, actorCount=8, companyCaseCount=6, caseCount=2496,
                servicePolicyMode=service_mode, servicePolicyRoleGraphClosed=True,
                serviceChangedPoliciesInert=76 if service_mode=='bypass' else 0, businessGraphAccepted=False,
                schemaAccepted=False, generatedTypesVerified=False)


def validate_result(result):
    if (type(result) is not dict or result.get('servicePolicyMode') not in ('bypass', 'evaluated')
            or result != expected_result(result.get('servicePolicyMode'))
            or any(type(result[key]) is not type(value)
                   for key, value in expected_result().items())):
        raise ValueError('POLICY_ACTOR_RESULT_REQUIRED')
    return result


def _controller():
    path = ROOT/'scripts/canonical-auth-provisioning-replay.py'
    spec = importlib.util.spec_from_file_location('policy_actor_controller_entry', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.controller()


def _admit(target):
    from canonical_native_timestamp_proof import NativeTimestampTarget
    if type(target) is NativeTimestampTarget:
        target.assert_native_owned()
        return 'postgres', True
    try:
        controller = _controller()
        controller.load_repair().require_owned(target, reference=True)
        controller.load_dedupe().require_live(target)
    except Exception:
        raise ValueError('POLICY_ACTOR_OWNED_TARGET_REQUIRED') from None
    return 'gridex_auth_legacy_replay', False


def _complete(progress, native):
    from canonical_forward_sources import FORWARD_SOURCES
    report = progress.get('forwardSources', {})
    receipts = report.get('sources', [])
    foundation = 'foundationInputsExecuted' if native else 'foundationApplied'
    timestamps = 'timestampInputsExecuted' if native else 'timestampApplied'
    flags = ('executed', 'noOpRepeatVerified', 'rowsPreserved') if native else (
        'executed', 'positiveAndRepeatVerified', 'rowsPreserved')
    if (progress.get(foundation) != 144 or progress.get(timestamps) != 514
            or len(FORWARD_SOURCES) != 12 or report.get('executed') is not True
            or report.get('inputsExecuted') != 12 or len(receipts) != 12
            or any((r.get('source'), r.get('sourceSha256')) != pair
                   or any(r.get(flag) is not True for flag in flags)
                   for r, pair in zip(receipts, FORWARD_SOURCES))):
        raise ValueError('POLICY_ACTOR_COMPLETE_REPLAY_REQUIRED')


def _snapshot(target, database, native):
    if native:
        from canonical_native_timestamp_runtime import native_snapshot
        return native_snapshot(target)
    from canonical_forward_portable import snapshot
    return snapshot(target)


def _policy_context(target, database):
    names = ','.join("'" + table + "'" for table in sorted(
        {p[0] for p in POLICIES} | {p[0] for p in SERVICE_POLICIES}))
    query = """SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.relname,x.polname),'[]') FROM (
      SELECT n.nspname,c.relname,p.polname,p.polcmd::text AS command,p.polpermissive AS permissive,
        coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') AS using_expression,
        coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') AS check_expression,
        ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END
              FROM unnest(p.polroles) r ORDER BY 1) AS roles
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN (""" + names + ')) x;'
    rows = json.loads(target.sql(database, query, 'policy_actor_context'))
    expected = {(table, name): digest for table, _, name, _, digest in POLICIES}
    expected.update({(table,name): digest for table,name,digest in SERVICE_POLICIES})
    actual = {(r['relname'], r['polname']): _sha(r) for r in rows
              if (r['relname'], r['polname']) in expected}
    if actual != expected:
        raise ValueError('POLICY_ACTOR_RETAINED_PREDICATES_REQUIRED')
    return _sha(rows)


def _sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def validate_execution_receipt(receipt, *, native):
    keys = set(expected_result())
    extra = {'source', 'sourceSha256', 'completePolicyContextSha256',
             'catalogAndRowsPreserved', 'nativeTarget', 'ledgerProvenanceAccepted'}
    if (type(native) is not bool or type(receipt) is not dict or set(receipt) != keys | extra
            or receipt.get('source') != SOURCE or receipt.get('sourceSha256') != SOURCE_SHA256
            or type(receipt.get('completePolicyContextSha256')) is not str
            or not re.fullmatch('[a-f0-9]{64}', receipt['completePolicyContextSha256'])
            or receipt.get('catalogAndRowsPreserved') is not True
            or receipt.get('nativeTarget') is not native
            or receipt.get('ledgerProvenanceAccepted') is not False):
        raise ValueError('POLICY_ACTOR_RESULT_REQUIRED')
    validate_result({key: receipt[key] for key in keys})
    return receipt


def execute(target, retained, progress):
    """Parent calls after full forward effects; parent retains ledger admission.

    No SQL, database name, external URL or expected-result override is accepted.
    Full composition hashes are evidence bindings, not an acceptance allowlist.
    """
    raw = validate(retained)
    database, native = _admit(target)
    _complete(progress, native)
    before = _snapshot(target, database, native)
    context = _policy_context(target, database)
    result = validate_result(json.loads(target.sql(database, raw.decode(),
                                                  'policy_actor_qualification', transaction=False)))
    _admit(target)
    if _snapshot(target, database, native) != before or _policy_context(target, database) != context:
        raise ValueError('POLICY_ACTOR_ROLLBACK_REQUIRED')
    return dict(result, source=SOURCE, sourceSha256=SOURCE_SHA256,
                completePolicyContextSha256=context, catalogAndRowsPreserved=True,
                nativeTarget=native, ledgerProvenanceAccepted=False)
