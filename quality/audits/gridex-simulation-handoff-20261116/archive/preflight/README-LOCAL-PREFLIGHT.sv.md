# Gridex OPS: verifiera lokal körning på Mac

## Vad som är verifierat

OpenAIs aktuella dokumentation anger att **Local** och **Worktree** körs på datorn. I en ny Codex-chatt väljs **Work in → This computer**. Cloud använder en separat miljö; lokala filer, processer och tjänster överförs inte automatiskt.

Källa: https://learn.chatgpt.com/docs/environments/modes

Nuvarande körmiljö är en hanterad Linux-miljö i molnet. Den har31,5GiB gemensam disk för `/workspace` och `/var/lib/docker`; `/tmp` är8,8GiB RAM-disk. Ingen lokal Mac-terminal eller automatisk överlämning har verifierats från denna molntråd. Macens resurser är ännu inte kontrollerade.

## Gör så här först

1. Spara det här lilla preflight-paketet på Macen och packa upp det i en lokal arbetsmapp.
2. Öppna en ny Codex-uppgift i skrivbordsappen, välj arbetsmappen och **Work in → This computer**. I andra appversioner kan valet visas som **Local**. Välj appens Codex-läge om produktväljaren visas.
3. Ge den lokala agenten denna instruktion:

   > Läs README-LOCAL-PREFLIGHT.sv.md. Kör bara `bash local-preflight.sh` från den lokala Mac-arbetsmappen. Rapportera CPU-arkitektur, eventuell Rosetta, RAM, ledigt diskutrymme och Docker-serverns arkitektur/drivrutin/minne. Kontrollera att kommandona körs på Macen och att Docker-servern är rätt lokal instans. Ändra eller installera inget, starta eller ta bort inga containrar och överför inga databaser eller hemligheter. Föreslå därefter en konkret Linux-körmiljö för Gridex-testerna.

4. Använd resultatet för miljöval och migreringsplan. Detta paket migrerar inte testdatabasen och återupptar inte automatiskt simuleringarna.

`local-preflight.sh` skriver endast rapport till terminalen. Det läser begränsade system-/Dockerfält och visar inte full Docker-konfiguration, miljövariabler, proxyadresser eller autentiseringsuppgifter. Om en icke-lokal Dockeranslutning är vald hoppar det över serverkontrollerna. En Unix-socket ensam bevisar inte vilken server som ligger bakom den. Scriptet kräver inga administratörsrättigheter. Det är syntaxkontrollerat här, inte exekverat på din Mac.

## Om Docker Desktop behöver mer lagring

Dockers dokumentation beskriver **Settings → Resources → Advanced**, med **Disk usage limit** och **Disk image location** på Mac. Disk usage limit är en maximal storlek för Linuxvolymen och skapar inte extra fysisk SSD-kapacitet. Vi kontrollerar därför först ledigt utrymme både där projektet ska ligga och där Docker lagrar sin diskavbild.

Planeringsmål: minst100GiB tillgänglig testlagring och cirka30GiB diskbaserat temporärt utrymme. Det är dimensioneringsmål, inte påstådda minimikrav eller verifierade Mac-resurser. Befintliga Docker-arbeten och eventuellt krav på omstart ska tas med innan inställningar ändras. Inga inställningsändringar ingår i preflight.

Källa: https://docs.docker.com/desktop/settings-and-maintenance/settings/#resources

## Innan tester flyttas

Nuvarande körare är Linuxbunden: `/proc`, cgroup-v2, fasta absoluta sökvägar, UID/PID-kontroller, Docker-socket, nätverksnamespace och direktåtkomst till container-IP. Den pinnade Storage-avbilden och Node-binären är Linux/amd64. Se PORTABILITY-REVIEW.sv.md när den finns i paketet. På Apple Silicon behöver vi uttryckligen välja och kvalificera nativ ARM64 eller AMD64-emulering. En vanlig container på Mac med värdens Docker-socket löser inte automatiskt sökvägar och nätverk.

Nästa steg efter godkänd preflight är en granskningsbar Linux-miljöplan, sedan kontrollerad export/överföring och ny lokal baslinje. Befintliga molndata bevaras. Inga hemligheter eller privata databaskopior följer med detta preflight-paket.

Originalstatus vid förberedelsen:105 scenarier,43 fullständiga PASS,1 dokumenterad GAP och61 ofullständiga. Fyra nya EDIEL-fall har ännu inte körts och ingen operatör hann logga in. Sista konstruktionsprovet skapade sent en egen aldrig startad container; den är verifierad borttagen. Enbart infrastrukturförberedelser ger ingen scenario-PASS.
