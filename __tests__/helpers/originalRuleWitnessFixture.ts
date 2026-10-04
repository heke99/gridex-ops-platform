/** Explicit registry-response fixture; no authentic original or live proof. */
export function originalRuleWitnessFixture(input:{profileKey:string;messageProfileId:string;rulePackId:string;sourceHash:string}) {
  return {...input,version:'26.A:r3',snapshot:{
    rulePack:{id:input.rulePackId,source_hash:input.sourceHash,guide_version:'26.A',guide_revision:'3'},
    messageProfile:{id:input.messageProfileId,rule_pack_id:input.rulePackId,profile_key:input.profileKey},
    guideSources:[{id:'00000000-0000-4000-8000-000000000099',rule_pack_id:input.rulePackId,title:'Declared synthetic source row'}],
  }}
}
