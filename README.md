# Industrilåsappen – prioritering för dagens arbetssätt

Version 1.1. En lokal hjälp för att välja nästa jobb på linan och uppskatta vad bemanningen räcker till. Nitad sida och Rotary ligger kvar på separata tillverkningsorder. Orderkalkylen, produktmallarna, arbetstiderna, raster, skift och offline-stödet finns kvar.

Appen visar egna planeringsuppgifter. Den är inte ansluten till Monitor G5 och beräknar inte lagersaldo, materialreservationer eller lagertransaktioner. Registreringar i kalkylen är lokala anteckningar om arbete och takt.

## Börja här

1. Välj **Lina 4** och **Planera från nu**. Ange hur många personer som faktiskt är tillgängliga för jobben i denna plan. Sätt kväll till **0** om ingen kvällsbemanning finns.
2. Välj **Lägg till order**. Lägg in nitorderns eget ordernummer och välj **Lagerstyrd**. Lägg Rotary på sitt eget ordernummer med **Kundorderstyrd**.
3. Ange artikel och benämning om du vill. Välj om måldatumet är ett **planerat färdigdatum** eller **kundens leveransdatum**. Datumet kan lämnas tomt.
4. Lägg operationerna på respektive order i den ordning de ska köras. Samma order med operation 10 och 20 är **en order med två operationer**. Operationsnummer och arbetsnamn anges var för sig. Appen bestämmer inte vad 10 eller 20 betyder.
5. Ange **kvar att göra per operation**, uppskattad stycktid för en person och arbetsplats. Tomt kvarvarande antal på en ny operationsrad betyder hela den planerade körningen. **0** betyder att operationens arbete är klart i planen. Tom stycktid betyder att tidsprognos saknas; prioriteringen kan ändå användas.
6. Koppla den nitorder som behövs under **Behövs från andra order** på Rotary-ordern. En nitorder kan kopplas till flera Rotary-order och en Rotary-order kan vänta på flera order. Inga kopplingar skapas automatiskt från artikelnummer eller vänster/höger.
7. Ange om arbetet i övrigt kan köras, behöver kontrolleras eller är stoppat. Beskriv hinder och osäkerheter i anteckningen.
8. Bekräfta **Överlämning klar för denna körning** när underlaget räcker till den mängd du tänker köra. Det kan vara en delöverlämning. Bekräftelsen gäller just denna koppling och drar inte av några stycken någonstans.

Du kan prova tre tydligt märkta, påhittade Rotary-exempel. De innehåller antagna tider, mängder, moment och kopplingar. De läggs till utan att ersätta egna order och kan tas bort tillsammans.

## Vad prioriteringen visar

**Nästa steg per arbetsplats** visar den högst prioriterade körbara orderns nästa operation. Under **Order & överlämningar** syns också blockerade arbeten och varför de behöver följas upp. Sökning och arbetsplatsfilter ändrar bara visningen, inte bemanningen i linans tidsförslag.

Prioriteringen följer:

1. Manuell hög, normal eller låg prioritet.
2. Tidigaste måldatum, med odaterade order sist inom samma prioritetsnivå.
3. Vid samma prioritet och datum går ett kundbehov före en fristående lagerorder. Ordernumret ger en stabil ordning vid lika utfall.

En väntande order för över sitt tidigare måldatum och sin högre prioritet till den order den behöver. Därför kan en lagerstyrd nitorder hamna först när den behövs till en brådskande Rotary-order. Höjd prioritet upphäver aldrig ett hinder eller en väntande överlämning. Förslaget är en tydlig körregel, inte en garanti för matematiskt optimal leveransplanering.

## Arbetsplatser och bemanning

På lina 4 finns namnförslagen **260-1**, **260-2** och **Rotary slutmontering**. Namnen går att ändra och behöver stämmas av mot era faktiska arbetsplatser. De är lokala planeringsresurser, inte en hämtad produktionsgruppsstruktur från Monitor.

260-1 och 260-2 behandlas som två separata maskiner. Välj den maskin operationen ska använda; appen antar inte att de är utbytbara eller att ett jobb måste passera båda. Samma resursnamn delar kapacitet mellan alla order i linans plan. Olika stora/små bokstäver behandlas som samma namn.

En enskild maskin har normalt **1 resursplats**. Fler platser under samma namn används bara för likvärdiga platser som verkligen kan köras parallellt. Planen räknar en montör per resursplats och begränsar även mot operationens maxbemanning. Alla arbetsplatser delar den bemanning du anger för linan. Övriga linor får inte automatiskt del av samma personer.

## Tidsförslaget

Arbete kvar per operation = kvarvarande antal × stycktid × (1 + indirekt tillägg / 100).

Operationernas arbetstid summeras. Antal stycken över flera operationer summeras inte till en färdig produktmängd. Tidsförslaget tar hänsyn till skift, raster, gemensamma resurser, bemanning och operationernas körordning. Inställningarna från den tidigare appen kan fortfarande ändras.

I tidsförslaget antas en väntande överlämning ske när föregående orders **hela kvarvarande planerade arbete** är klart. Det är ett antagande för tidsberäkningen. Körklar-listan kräver fortfarande manuell bekräftelse av överlämningen, också om föregående order har 0 kvar. För en tidigare delöverlämning kan du begränsa planerad körning och bekräfta att just den körningen har underlag.

Order med okända tider, arbetsplatser eller stopp får ingen säker sluttid. Det gäller även order som väntar på dem. Ett ännu öppet beroende från en annan lina visas som något som behöver lösas, utan gissad kapacitet från den linan. Order utan måldatum kan tidsplaneras, men får inget besked om leverans i tid.

Kväll används i tidsförslaget bara om kvällsbemanning finns och sökningen hittar ett bättre utfall. Den försöker få order schemalagda och minska sammanlagd försening mot kända måldatum, med mindre kvällstid vid lika utfall. Den manuella prioritetsregeln ligger kvar.

## Orderkalkylen och sparade uppgifter

**Till orderkalkyl** för över orderns mängder, tider och redan utförda arbete. Ordern och kopplingarna ligger kvar i planen. Under kalkylen kan du välja **Uppdatera kvar att göra i planen**. Bara kvarvarande arbete uppdateras; överlämningar bekräftas separat. Om planeringsordern har ändrats sedan kalkylen öppnades behöver kvarvarande arbete uppdateras direkt i planen.

Inställningar, produktmallar, planerade order och pågående kalkyl sparas lokalt på enheten. Säkerhetskopian under inställningar innehåller även operationer, kopplingar och bedömningar. Uppgifter synkas inte mellan personer eller enheter.

Äldre sparade order läses in med sina mängder, tider och produktmallar. Nya uppgifter lämnas för kontroll: lina förväljs till 4, ordertyp är ej angiven, datum tolkas som planerat färdigdatum och körklar-status behöver kontrolleras. Operationsnummer gissas inte. En kopplad order kan inte raderas utan att kopplingarna först hanteras.

## Uppdatera din befintliga app

Exportera gärna en säkerhetskopia från den befintliga appens inställningar. Ersätt sedan appfilerna på din nuvarande webbplats med filerna i denna mapp, inklusive den nya **planning.js**. Behåll samma webbadress för att använda samma lokalt sparade uppgifter. Öppna appen online efter uppdateringen så att offline-versionen kan uppdateras. Kontrollera äldre order innan du använder tidsförslaget.

Paketet är färdigt för statisk webbhosting, exempelvis en befintlig GitHub Pages-publicering. Ingen serverdel eller installation av paket krävs. Den här leveransen ändrar inte en redan publicerad webbplats automatiskt.

För att köra från datorn:

```sh
python3 -m http.server 8000
```

Öppna `http://localhost:8000`. På iPhone kan en publicerad HTTPS-version läggas till via Safari → Dela → Lägg till på hemskärmen.

## Kontroller

```sh
npm test
npm run check
```

Testerna täcker arbetstider, raster, parallell bemanning, gemensamma maskiner, beroenden, manuella delöverlämningar, operationsidentitet, kvarvarande belastning, saknade uppgifter, noll kvällsbemanning och övergång från äldre sparade order.
