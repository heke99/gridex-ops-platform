# Källbevarande för fortsatt simuleringsarbete

Detta är ett filtrerat källarkiv, inte ett körbart Macpaket. Inkluderade filers bytes är oförändrade och verifierade med SHA256. Source65 och uttryckligen klassificerade icke-hemliga käll-/metadataposter har prövats; undantag och saknade filer anges i manifestet. Inga absoluta eller andra symlänkar kopieras.

Miljöfiler, privata baseConfig/DB-/rådatafiler, nycklar, tokenmönster, binärer, node_modules och uttryckligen privata poster ingår inte. Token/PEM-sökningen är offline och skriver aldrig ut matchade värden. Den är mönsterbaserad och är inte ett bevis för frånvaro av alla tänkbara hemligheter.

Fullständiga transitiva beroenden, runtime, paketversioner, Linux/Mac-kompatibilitet, aktuella roller och normal autentisering måste kvalificeras separat. Bevara samma befintliga stagingdatabas; detta paket innehåller ingen DB och medger inte ersättning, återställning eller ny databas. Referenser till absoluta molnsökvägar i ursprunglig källtext är historiska och gör inte paketet portabelt. Ingen kod har exekverats och inga Docker-, SQL-, npm- eller Git-mutationer har utförts.
