# Industrilåsappen

En mobilanpassad orderkalkyl för montering. Appen räknar återstående stycken, kartonger, arbetstid och beräknad sluttid med hänsyn till raster, arbetsdagar och flera medarbetare.

## Funktioner

- Flera delmoment per order, till exempel förmontering, slutmontering och packning
- Egen ledtid och eget startsaldo för varje delmoment
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
- Rekommendationen försöker minimera sena ordrar, total försening och därefter mängden kvällstid
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

### Presets

På startsidan kan den aktuella produktkonfigurationen sparas som en preset. En preset sparar kartongstorlek, delmomentens namn och ledtider, indirekt tid och om kvällsskiftet ska räknas med. Orderantal, starttid och färdigt före start sparas inte eftersom de normalt varierar mellan order. Presets lagras lokalt på enheten och följer med i appens säkerhetskopia.

### Orderplanering

I **Orderplanering** kan flera kommande ordrar läggas in med orderantal, preset och deadline. Planeringen använder presetens delmoment, ledtider och indirekta tillägg tillsammans med vald bemanning på dag- och kvällsskift.

Kvällsskift behöver inte markeras per planerad order. Appen räknar automatiskt:

1. först ett upplägg med enbart dagskift,
2. därefter alternativa upplägg där kvällsskift får avlasta de ordrar som förbättrar deadlineutfallet,
3. och väljer rekommendationen med minst antal sena ordrar, minst total försening och så lite kvällstid som möjligt.

Om dagskiftet räcker visas **Kvällsskift: Behövs inte**. Om kväll krävs visas hur många kvällspass och ungefär hur mycket kvällstid som rekommenderas, samt vilka ordrar som bör köras där. Om kapaciteten fortfarande inte räcker trots kvällsskift visas en tydlig deadlinevarning.

När en planerad order skickas vidare till orderkalkylen förs den rekommenderade kvällsinställningen med automatiskt.
