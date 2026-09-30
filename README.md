# hackathon

TARCZA – Taktyczny Asystent Rozpoznania w Czasie Akcji

Dashboard dla dowódców i jednostek biorących udział w akcji ratowniczej (pożar, poszukiwanie zaginionego). Drony zbierają dane, a system składa je w jeden wspólny obraz sytuacji, który widzą wszyscy uczestnicy akcji.

Zespół SM Labs: Szymon Piskor, Michał Kalinowski. Projekt powstał na Dual Use Hackathon (systemowe wykorzystanie dronów w zarządzaniu kryzysowym).

Zamysł

Czas jest kluczem, więc dashboard jest zrobiony tak, żeby niczego nie trzeba było konfigurować w trakcie akcji:

Wystarczy sparować drona, resztą system zajmuje się sam.
Każdy może pomóc. Osoba prywatna może dobrowolnie udostępnić swojego drona służbom na czas akcji.
Bez tracenia czasu na wymianę informacji. Nie trzeba dzwonić i prosić o dostęp do drona. Jeśli dron jest wolny, można się pod niego podpiąć albo tylko podejrzeć, co robi dany operator (dron może latać autonomicznie lub można go przejąć).
Wszyscy widzą to samo. Kto dołącza do akcji, dostaje te same informacje co pozostali.
Jak to działa
Dowódca tworzy zgłoszenie (albo dołącza do istniejącego) w Hubie zgłoszeń.
Zaznacza teren: obszar pożaru i obszar poszukiwań.
Drony zbierają informacje najpotrzebniejsze służbom. Zaznaczone strefy niczego nie sterują sprzętowo: dron nie dostaje polecenia, żeby latać w strefie, a system nie robi samowolki. Strefy mówią, gdzie służby potrzebują informacji.
Dane trafiają do AI albo do algorytmu, dzięki czemu dowodzący dostają ważne informacje szybciej.
Dowódca i jednostki widzą jeden panel i na jego podstawie działają.
Co potrafi
Zgłoszenia: tworzenie i dołączanie, zaznaczanie terenu pożaru i terenu poszukiwań.
Drony: parowanie, udostępnianie własnego drona jako wsparcia zewnętrznego, podgląd obrazu, informacja, ilu operatorów aktualnie podgląda danego drona.
Analiza pożaru: siatka temperatur i wyświetlenie możliwych kierunków, w które ogień może się przenieść.
Poszukiwania: jeśli warunki sprzyjają, człowieka można wykryć na kamerze lub w termowizji.
Stan budynków (LiDAR): porównanie pomiarów LiDAR z drona z danymi pomiarowymi z Geoportalu pozwala szybko ocenić przechył i uszkodzenia budynku. Dzięki temu można wcześniej wykryć budynek, który grozi zawaleniem, i szybko ostrzec odpowiednie drużyny.
Widok 2D i 3D: każdy wybiera ten, z którego łatwiej mu korzystać. 3D włącza się automatycznie tam, gdzie mamy dane terenu z plików ASC, poza nimi zostaje mapa 2D.
Asystent AI: ocena ryzyka, propozycja ewakuacji, komunikat głosowy dla drona, raport z akcji.
Mapa zagrożeń w skali kraju (dane IMGW).
Dane z Geoportalu i pliki ASC (NMT i NMPT)

Aplikacja korzysta z danych z geoportal.gov.pl: podkładów map oraz numerycznych modeli wysokościowych w formacie ASC (siatka ESRI ASCII, układ PL-1992, EPSG:2180).

Ważne do zauważenia:

NMT (numeryczny model terenu) opisuje samo ukształtowanie terenu. Z niego powstaje teren w widoku 3D.
NMPT (numeryczny model pokrycia terenu) opisuje też budynki i roślinność. Ma ten sam format, więc interpreter czyta go tak samo. Różnica NMPT − NMT daje wysokości budynków, ale w obecnej wersji wysokości budynków w 3D pochodzą z OpenStreetMap (a gdy ich brak, przyjmowane jest domyślne 6 m). Wykorzystanie NMPT do zmierzonych wysokości jest kolejnym krokiem.
Interpreter ASC

To prototyp koncepcji, a nie gotowy system operacyjny:

Dane z dronów, ogień i ruch jednostek są symulowane, w dodatku w przyspieszonym czasie. W rzeczywistości ogień rozprzestrzenia się inaczej, a pojazdy, drony i pozycje gaśnicze zachowują się inaczej.
Skan LiDAR z drona i ocena zawalenia budynku to założenie projektu. W prototypie nie ma prawdziwego drona ani prawdziwych pomiarów.
Tryb „Edge AI” (lokalna analiza bez chmury) zwraca gotowe odpowiedzi rezerwowe, a nie wynik prawdziwego modelu działającego na urządzeniu.
Ocena stanu budynku to narzędzie do ustalania kolejności sprawdzania, a nie werdykt inżynierski. Decyzję zawsze podejmuje człowiek.
Logowanie ma konta demonstracyjne zapisane na sztywno w app/api/auth/login/route.ts. Przed jakimkolwiek wdrożeniem trzeba je zastąpić prawdziwym uwierzytelnianiem.
Charakter defensywny. Projekt nie obejmuje uzbrojenia, zakłócania łączności ani przejmowania cudzych dronów. Dane zbieramy po to, by dowódcy mieli ważne informacje do szybkich decyzji.
Źródła i narzędzia
-geoportal.gov.pl – mapy, dane wysokościowe (NMT, NMPT) i pomiary LiDAR
-gemini.ai – asystent AI w aplikacji (Gemini API) oraz wsparcie przy pracy nad projektem
-claude.ai – wsparcie przy pracy nad projektem (m.in. interpreter ASC i widok 3D)
-OpenStreetMap – podkład mapy, budynki i drogi
-IMGW – dane pogodowe do mapy zagrożeń
