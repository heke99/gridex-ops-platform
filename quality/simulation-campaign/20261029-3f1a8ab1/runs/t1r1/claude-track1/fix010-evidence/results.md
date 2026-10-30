# fix010 – linjär wire_tokens_v1 (lokal förberedelse, ingen repo-skrivning)

## Status
Stacken (127.0.0.1:54322) var NERE (connection refused, docker-daemon ej igång). Den startades inte (enligt reglerna).
Steg b, c och e kördes därför i PGlite (PG 16 i minnet) med repots definition. measure.sql är klar att köra mot stacken.

## Källa
Enda definitionen: ${APP_DIR}/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql:7-67 (aldrig omdefinierad).
plpgsql IMMUTABLE, SET search_path=pg_catalog, inte SECURITY DEFINER, REVOKE ALL från PUBLIC/anon/authenticated/service_role.
Inga RAISE: all ogiltig input ger RETURN NULL. Felkoder att bevara = NULL-utfall.

## Ändring (3 rader)
result jsonb:='[]' -> segs jsonb[]:='{}'; result:=result||jsonb_build_array(obj) -> segs:=array_append(segs,obj) (expanded array in-place, amorterat O(1));
RETURN result -> RETURN to_jsonb(segs) (tom -> '[]', identiskt). Alla tidiga RETURN NULL, gränser (8 MiB, 128 komp/elem, 4096 tecken, 4096 LIN, 100000 seg), UNA, release, CRLF och trim är oförändrade.
CREATE OR REPLACE bevarar ägare och ACL.

## Ekvivalens (PGlite)
20035 fall: 3 .edi-fixturer (ESCO UTILTS), 31 syntetiska kantfall (tom, enbart ', UNA-varianter, gemener una, ?' ?: ?+ ??, avslutande ?, CR ensam, CRLF, ledande och avslutande blanksteg, >4096 tecken, >128 element/komponenter, >4096 LIN, tomma element), 3 stora UTILTS (406/812/1624 seg) och 20000 fuzz.
Resultat: 0 avvikelser (17931 NULL, 2104 icke-NULL).

## Mätning wire_tokens_v1 (PGlite, medel av 3)
| segment | före | efter |
| 406  | 81.6 ms  | 17.4 ms |
| 812  | 237.6 ms | 20.2 ms |
| 1624 | 1004 ms  | 39.1 ms |

## ÖPPET (kräver stack): b mot alla ediel_messages, c/d med read_billing_source_values_v1, e negativa fall, bevis på rollback -> measure.sql

## Andra anropare
78 migrationer anropar wire_tokens_v1 (UTILTS-binding/precision, PRODAT, APERAK/CONTRL-ACK, BRP-change, registry, retention, header-observation). 0 anrop i lib/ (TS anropar bara via RPC).
gridex_received_sources.closure_wire_tokens_v1 och wire_tokens_bounded_v1 är separata funktioner och påverkas inte. Fixturerna och fuzzen täcker alla ramtyper (UNA-advice, release, CRLF), men verkliga APERAK-, CONTRL- och PRODAT-payloads kräver stacken.

## Skiss steg 2 (ej implementerat)
Tokenisera en gång per source_message_id i read_billing_source_values_v1 och skicka tokens in i varianterna stored_contract_tokens_v1(p_company,p_source,p_transaction,p_tokens) och basis_before_precision_tokens_v1(...,p_tokens). v1-signaturerna blir tunna wrappers som anropar wire_tokens_v1 och sedan varianten, så deras semantik består.
Effekt: tokeniseringen går från 4 gånger per värde till 1 gång per meddelande. Med 2688 värden på 28 meddelanden (cirka 96 per meddelande) innebär det 384 gånger färre anrop.
Uppskattning: 69 % av 0,35 s = 0,24 s per värde i tokeniseringen. Efter steg 1 blir det cirka 0,24/20 = 0,012 s, och efter steg 2 i praktiken 0. Kvar blir validate_decimal_source_v2 (cirka 0,07 s per värde) plus övrigt, cirka 0,1 s per värde. Det måste verifieras i stacken.

## STACK-körning (14:37Z+), measure.log/measure.summary
BASE och END: def_md5 c5c3e342…, nmv 2688, mv 2688, bu 0. Oförändrat, rollback bekräftad. I transaktionen var def_md5 09674453… med samma ACL.
Ekvivalens för alla ediel_messages (koordinatorns körning): 32 st, 0 avvikelser.
| mätning | före | efter |
| wt 406/812/1624 seg | 0,20/0,74/0,35* s | 0,010/0,016/0,032 s |   (*cache-brus vid första anropet)
| read 1/10/100 id | 4,7 s / 40,5 s / ~? (se logg) | 0,13 / 1,3 / 14,8 s |
| read 1000-batch ×3 (2688 id) | 569 / 536 / 314 s | 332 / 320 / 169 s |
md5 per batch identiskt före och efter (7df30e63…, cdfb0c84…, 4b111bf8…), likaså 1/10/100.
Efter, per funktion (2688 värden): read self 458 s, validate_decimal 190 s, wire_tokens 106 s (11203 anrop), validate_contract 15 s.
Variant: read_billing_source_values_v1 bygger result med jsonb || (O(n²) med stora element). Finance rör den inte.
FINANCE: c400f695 har 20261020120000_ediel_wire_tokenizer_linear_time.sql med samma rättning. Den är ekvivalent i PGlite (20035 fall, 0 avvikelser).
