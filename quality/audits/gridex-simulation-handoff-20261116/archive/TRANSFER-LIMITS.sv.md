# Vad överlämningen säkrar och vad som återstår

Överlämningen ger den nya agenten en bestämd startpunkt, samma uppdrag och bevarade tillgängliga kod-/dokumentationsunderlag. En ny lokal Codex-uppgift fortsätter arbetet genom dessa filer; den ärver inte processer, aktivt minne, databasanslutningar eller molnbehörigheter automatiskt.

Manifesten anger exakt vilka filer som ingår. `EVIDENCE-INDEX.safe.json` mappar kopierade rapporter till ursprungssökväg, storlek och SHA256. Saknade eller uteslutna hänvisningar är inte bevisat raderade och inte heller överförda. Källbevarande redovisas separat i `simulation-source/SHA256-MANIFEST.v2.safe.json` och `simulation-source/README.v2.sv.md`; originalmanifestet är historik. `candidate-patches/` innehåller sju unapplied kandidater; huvudkatalogen `main/` förblir ren.

Följande är inte överfört eller kvalificerat:

- Befintlig stagingdatabas, privata databasrader, dump/restore eller ny databas. Målet är fortfarande samma befintliga staging, inte en kopia. Kontrollera dess fortsatta livslängd separat; en sparad databasidentitet garanterar inte att en molnmiljö bevaras obegränsat.
- Säker anslutning från Mac till den molnbundna stagingmiljön. Inget VPN, autentiserad tunnel, publik ingress eller kontrollplansadapter har skapats. Lokal agent ska verifiera en stödd privat väg innan autentisering och skrivning. Saknas sådan väg är detta en uttrycklig blockerare som kodkopiering inte löser.
- Lösenord, signeringsnycklar, DSN-hemligheter, användarsessioner eller privat runtimekonfiguration. Befintliga molnnycklar/sessioner får inte antas giltiga lokalt. Hemligheter lämnas genom avsedd hemlighetshantering, inte Git, rapport eller chatt.
- Komplett installerad transitive dependency-miljö, containerbilder, CPU-/OS-anpassning eller kvalificerad Linux-exekverare. Källornas absoluta sökvägar och kontroll av /proc/cgroup/Docker/nätverk måste granskas för det valda utförandet.
- Alla historiska råkvitton, stora diagnostikfiler och arkiv. De dokumenterade urvalen och manifesthänvisningarna ersätter inte saknade originalbyte. Avveckla inte den gamla miljön under antagandet att ZIP-filen innehåller alla sådana artefakter.
- Det officiella Nordfin-XSD/avrundningsunderlaget och originalserien med 28 meddelanden/1 809,51 kr. Användaren har bekräftat att de inte finns. Nya deklarerade syntetiska kontroller kan tillföra funktionell evidens men ersätter inte de ursprungliga acceptanskraven.

Äldre preflight-/producentrapporter i paketet är daterad evidens. DATABASE-CONTINUITY.safe.json och användarens senaste klargörande styr nu databasvalet. Den orörda scenariotabellen V5 styr de registrerade statusarna vid överlämningen. START-HERE och den aktuella fyndsammanställningen förklarar senare resursstängning; historiska rapporter skrivs inte om för att se nyare ut.

Innan den tidigare molnmiljön avvecklas: säkerställ fortsatt åtkomst till samma staging och säkra alla kvarstående privata eller opaketerade artefakter genom en uttryckligen vald säker överföringsväg. Det är kvarstående arbete, inte en redan genomförd överföring.
