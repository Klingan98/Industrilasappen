# Industrilåsappen

En mobilanpassad orderkalkyl för montering. Appen räknar återstående stycken, kartonger, arbetstid och beräknad sluttid med hänsyn till raster, arbetsdagar och flera medarbetare.

## Funktioner

- Flera delmoment per order, till exempel förmontering, slutmontering och packning
- Egen ledtid och eget startsaldo för varje delmoment
- Max antal montörer per delmoment, så fixtur- och stationsbegränsningar kan modelleras
- Valfri delad maskin/fixtur per moment med gemensam kapacitet mellan flera order
- Totalframsteg viktat efter delmomentens planerade arbetstid
- Ledtid per styck i sekunder eller minuter
- 20 % standardtillägg på orderns totala originaltid
- Ange färdiga kartonger och lösa stycken som redan var klara före orderstart
- Uppdatering efter varje kartong eller valfritt antal lösa stycken
- Prognos enligt originaltid och uppmätt persontakt
- Flera medarbetare med egna start- och sluttider
- Dagskift måndag–torsdag 07:00–16:00 och fredag 07:00–14:00 utan lunchrast
- Valbart kvällsskift måndag–torsdag 16:00–01:00
- Kvällsskiftets raster speglas från dagskiftet: 18:15–18:30, 20:00–20:15 och 22:30–23:10 med standardinställningarna
- Fredag har de två korta rasterna men ingen lång lunchrast; detta kan ändras i inställningarna
- Inget kvällsskift startar på fredagar; torsdagens kvällsskift får fortsätta till fredag 01:00
- Lördagar och söndagar hoppas över
- Arbetstider, raster, arbetsdagar och tillägg kan ändras i inställningarna
- Sparbara produkt-presets med kartongstorlek, delmoment, ledtider, tillägg och skiftval
- **Orderplanering** med flera kommande ordrar, deadlines och rekommenderad körordning
- Automatisk bedömning av kvällsskift: appen provar först dagskift och använder kväll bara när det förbättrar deadlineutfallet
- Rekommendationen försöker minimera den sammanlagda deadlineförseningen för hela kön, därefter värsta enskilda försening, antal sena ordrar och mängden kvällstid
- Ledig bemanning fördelas parallellt mellan flera order och flera identiska maskin-/fixturplatser kan utnyttjas samtidigt när bemanningen räcker
- Lokal lagring, säkerhetskopia och offline-stöd
- Installerbar på iPhone via **Lägg till på hemskärmen**

All orderdata sparas lokalt i webbläsaren och skickas inte till GitHub.

## Testa lokalt

Kör följande från projektmappen:

```bash
python3 -m http.server 8000
```

Öppna sedan `http://localhost:8000`.

Kontrollera beräkningarna med:

```bash
npm test
npm run check
```

## Publicera med GitHub Pages

1. Skapa ett nytt repository på GitHub.
2. Lägg in projektets filer och skicka dem till grenen `main`.
3. Öppna **Settings → Pages** i repositoryt.
4. Välj **GitHub Actions** som källa under Build and deployment. Webbappen ligger direkt i repositoryts rot.
5. Vänta tills arbetsflödet **Publicera Industrilåsappen** är klart.

GitHub visar därefter adressen till appen.

## Lägg till på iPhone

1. Öppna appens adress i Safari.
2. Tryck på **Dela**.
3. Välj **Lägg till på hemskärmen**.
4. Aktivera **Öppna som webbapp** och tryck på **Lägg till**.

## Beräkningsprincip

```text
Originaltid per delmoment = orderantal × delmomentets originalledtid per styck
Original totaltid = summan av alla delmoments originaltid
Tillägg = original totaltid × vald procentsats
Planerad totaltid = original totaltid + tillägg
```

Schemalagda raster räknas inte som produktionstid. Faktisk persontakt bygger på registrerad arbetstid och får därför inget extra procentpåslag. Om **Ta med kvällsskiftet** är markerat räknas både dagskiftets och kvällsskiftets schemalagda produktionstid. Bemanningen följer fortfarande medarbetarnas start- och sluttider, så medarbetare bör avslutas/läggas till vid skiftbyte när bemanningen ändras.

### Färdigt före start

När en order startas kan ett startsaldo anges som färdiga kartonger och/eller lösa färdiga stycken. Startsaldot räknas direkt in i orderns framsteg och minskar återstående mängd och prognostiserad tid. Det räknas däremot inte som producerade stycken i taktuppföljningen. Faktisk persontid per styck baseras bara på det som registreras efter att ordern har startats.


### Delmoment

En order kan bestå av ett eller flera delmoment. Varje moment följs upp separat med eget startsaldo, egna registrerade kartonger och egen faktisk persontakt. Den övergripande framstegsprocenten viktas efter momentens originalledtid. Ett moment som står för en tredjedel av den planerade arbetstiden står därför också för en tredjedel av orderns totala framsteg.

När ett moment blir färdigt aktiveras nästa ofärdiga moment automatiskt. Det går även att byta aktivt moment manuellt i **Momentöversikt**. Persontiden kopplas till det moment som är aktivt, så taktuppföljningen hålls separat mellan exempelvis förmontering och slutmontering.

Varje moment kan dessutom få **Max montörer samtidigt**. Tomt värde betyder att momentet kan använda hela den tillgängliga bemanningen. Ett moment kan också kopplas till en **begränsande resurs**, till exempel `Press 1` eller `Fixtur A`, med ett antal tillgängliga enheter. Om samma resursnamn används i flera presets behandlar orderplaneringen den som samma fysiska resurs och överbelägger den inte. Om olika presets anger olika kapacitet för samma resurs används det lägsta värdet för en försiktig plan. Har resursen exempelvis kapacitet 2 kan två order använda varsin plats parallellt, eller en order använda båda platserna om momentets maxbemanning och tillgänglig personal tillåter det.

### Presets

På startsidan kan den aktuella produktkonfigurationen sparas som en preset. En preset sparar kartongstorlek, delmomentens namn och ledtider, kapacitetsgränser, namngivna maskiner/fixturer, indirekt tid och om kvällsskiftet ska räknas med. Orderantal, starttid och färdigt före start sparas inte eftersom de normalt varierar mellan order. Presets lagras lokalt på enheten och följer med i appens säkerhetskopia.

### Orderplanering

I **Orderplanering** kan flera kommande ordrar läggas in med orderantal, preset och deadline. Planeringen använder presetens delmoment, ledtider och indirekta tillägg tillsammans med vald bemanning på dag- och kvällsskift.

Planeraren arbetar på delmomentsnivå. Om ett moment exempelvis bara kan ta 1 montör medan dagskiftet har 4 personer kan de övriga 3 fördelas till andra körbara order. Finns två identiska pressar och minst två montörer försöker planen använda båda platserna parallellt, gärna på olika kritiska order först. Delmoment inom samma order körs fortfarande i rätt ordning. Namngivna delade resurser respekteras även mellan olika order, så två moment som båda kräver en ensam press schemaläggs inte samtidigt.

Kvällsskift behöver inte markeras per planerad order. Appen räknar automatiskt:

1. först ett upplägg med enbart dagskift,
2. därefter alternativa upplägg där kvällsskift får avlasta de ordrar som förbättrar hela köns deadlineutfall,
3. och väljer rekommendationen med minst sammanlagd deadlineförsening, därefter minsta värsta försening, antal sena ordrar och så lite kvällstid som möjligt. För upp till sju planerade ordrar provas alla kombinationer av kvällstilldelning.

Om dagskiftet räcker visas **Kvällsskift: Behövs inte**. Om kväll krävs visas hur många kvällspass och ungefär hur mycket kvällstid som rekommenderas, samt vilka ordrar som bör köras där. Om kapaciteten fortfarande inte räcker trots kvällsskift visas en tydlig deadlinevarning.

När en planerad order skickas vidare till orderkalkylen förs den rekommenderade kvällsinställningen med automatiskt.

### Visuell gruppering av samtidiga körningar
Orderplaneringens rekommenderade upplägg grupperar nu alla arbeten som pågår samtidigt i ett gemensamt tidsblock. Varje block visar skift, total bemanning, gemensam resursbelastning samt de order/delmoment som körs parallellt. Längre körningar delas automatiskt vid tidpunkter där den samtidiga bemanningen eller resursfördelningen ändras.

## Typografi

Gränssnittet använder nu en mer neutral, teknisk systemtypografi inspirerad av klassiska planerings-/ERP-gränssnitt: Segoe UI/Aptos med Helvetica Neue/Arial som fallback. Rubriker har något mindre extrem vikt och tracking, och siffror använder tabulära siffror för jämnare planeringsvyer.


### Typografi
Den här versionen använder en tydligare kompakt industritypografi med Arial-baserad brödtext och kondenserade rubriker/nyckeltal där plattformen stödjer det. Syftet är att efterlikna läsbarheten i traditionella produktions- och ERP-gränssnitt utan att vara beroende av ett externt webbtypsnitt.

## Kontinuitet och omställningar i Orderplanering

Orderplaneringen kan nu väga in den praktiska kostnaden för att ställa undan en order och byta en maskin/fixtur till en annan körning. Under **Planeringsram** finns:

- **Prioritera kontinuitet** – behåller pågående order på samma resurs när deadlineutfallet inte blir sämre.
- **Omställning vid orderbyte** – standard 15 minuter per resursplats som faktiskt byter order/moment.
- **Återstart efter paus** – standard 10 minuter när en tidigare körning måste tas fram igen efter att resursplatsen hunnit ställas om till något annat.
- **Minsta frivilliga körblock** – standard 120 minuter. Detta är en planeringspreferens; deadline-risk kan fortfarande motivera ett tidigare byte.

Planeraren kommer ihåg vad en namngiven resurs senast var uppställd för även när resursen står still. Vanliga raster och natt skapar därför inte automatiskt en omställning om samma order fortsätter på samma resurs efter pausen. Om två lika maskiner finns kan en order fortsätta på sin maskin samtidigt som en annan fortsätter på den andra. När flera planer klarar deadlines lika bra prioriteras planen med mindre omställnings-/återstartstid före en plan som bara sparar lite kvällstid.

Omställnings- och återstartstid läggs på planens verkliga persontid och visas i orderkort och rekommenderade körblock när den uppstår.
