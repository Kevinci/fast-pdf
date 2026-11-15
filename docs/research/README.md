# Recherche: ZUGFeRD / Factur-X und PDF/A-3 für fast-pdf

**Stand: 30.10.2026 · fast-pdf 0.8.1 · Commit `cd9f9ff`**

Entscheidungsgrundlage für die Frage, **ob und in welcher Form** fast-pdf
ZUGFeRD/Factur-X unterstützen soll — und was ein Writer dafür konkret können
muss. Diese Dokumente treffen **keine** Scope- oder Release-Entscheidung; sie
liefern belegte Fakten und, wo gefragt, eine fachlich begründete Einschätzung
von Aufwand und Risiko.

## Die Dokumente

| Datei                                                  | Beantwortet    | Inhalt                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) | Frage 1        | Alle PDF/A-3b-Anforderungen mit ISO-Klauselbezug, als Tabelle mit Pflicht-Spalte und Bezug auf konkrete fast-pdf-Dateien. ICC-Profilwahl inkl. gemessener Größen.                                                                                                         |
| [`zugferd-container.md`](./zugferd-container.md)       | Fragen 2, 3, 4 | Was ZUGFeRD zusätzlich vom Container verlangt (Dateiname, `/AF`, `/AFRelationship`, XMP-Extension-Schema), die Profile und ihre rechtliche Zulässigkeit, und wo der Schnitt zwischen PDF-Container und XML liegt. Mit empirischer Gegenprobe an zwei echten ZUGFeRD-PDFs. |
| [`validatoren-ci.md`](./validatoren-ci.md)             | Frage 5        | veraPDF, Mustang, KoSIT, qpdf, pdfcpu: Einbindung, Lizenz, Laufzeit, GitHub-Actions-Skizze. Auch für reines PDF ohne ZUGFeRD.                                                                                                                                             |
| [`stichtage-rechtslage.md`](./stichtage-rechtslage.md) | Frage 6        | DE B2B (§ 14, § 27 Abs. 38 UStG), DE B2G, EU ViDA, EAA/BFSG/PDF/UA, Frankreich — datiert, mit Fundstelle.                                                                                                                                                                 |
| [`stand-der-technik-js.md`](./stand-der-technik-js.md) | Frage 7        | pdf-lib, pdfkit, jsPDF, die ZUGFeRD-npm-Pakete, mustangproject, Python-`factur-x`. Gibt es schon eine dependency-freie JS-Lösung?                                                                                                                                         |

## Die wichtigsten Befunde auf einer Seite

### 1. ZUGFeRD ist zu 80 % ein PDF/A-3b-Problem, nicht ein ZUGFeRD-Problem

Der ZUGFeRD-Aufsatz auf einem fertigen PDF/A-3b ist klein: eine eingebettete
Datei `factur-x.xml`, ein Namensbaum, `/AF` am Katalog, vier XMP-Properties.
**3,5–5,5 Personentage** (Schätzung). Darunter liegen **11–22 Personentage**
für PDF/A-3b selbst — XMP-Writer, OutputIntent mit ICC, erzwungenes
Font-Embedding und eine Reihe von Verboten. Wer ZUGFeRD sagt, sagt PDF/A-3b.

### 2. Drei konkrete Blocker im heutigen Code

| Blocker                                                                                 | Datei                                                                  | Regel                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| **Standard-14-Fonts werden ohne `FontFile` geschrieben** — und das ist der Default-Pfad | `src/fonts/font.ts:76–83`, `resolveFont()` Z. 104–112                  | ISO 19005-3 `[6.2.11.4.1-1]`  |
| **Kein `/Metadata` im Katalog** — XMP fehlt vollständig                                 | `src/document/document.ts:3193–3208`                                   | `[6.6.2.1-1]`, `[6.6.4-1…-3]` |
| **Kein OutputIntent** — damit ist jedes `DeviceRGB` im Dokument ein Fehler              | fehlt; RGB u. a. in `src/images/png.ts:119`, `src/images/image.ts:106` | `[6.2.4.3-2]`                 |

Dazu zwei kleinere, aber sichere Treffer: **Link-Annotationen ohne `/F`**
(`src/document/document.ts:3445–3450`, Regel `[6.3.2-1]` — `node-zugferd` ist
über exakt dieselbe Regel gestolpert und repariert sie nachträglich), und
**Verschlüsselung im Trailer** (`src/pdf/writer.ts:192`, `[6.1.3-2]`), die im
PDF/A-Modus hart abgelehnt werden muss.

**Was heute schon passt:** Header mit Binärkommentar, `/ID` im Trailer,
Flate-Kompression, keine LZW-Filter, keine verbotenen Aktionen, `ToUnicode`
(damit wäre **3u** fast geschenkt), und — weil `src/pdf/import.ts` bereits
`/Launch` und `/JavaScript` herausfiltert — ein sauberes Aktionsmodell.

### 3. Das Bundle-Argument ist entkräftet: 456 Bytes

Die naheliegende Sorge, ein ICC-Profil sprenge die beworbenen ~13 KB min+gzip,
trifft nicht zu. `sRGB-v2-micro.icc` aus _Compact ICC Profiles_ ist **456 Bytes
roh, 349 Bytes gzip**, steht unter **CC0 1.0** und erfüllt die
veraPDF-Anforderung `[6.2.3-1]` nachweislich (Device Class `mntr`, Farbraum
`RGB` — selbst aus dem ICC-Header gelesen). Zum Vergleich: pdfkit, node-zugferd
und @lucaapp/zugferd-ts bündeln alle dieselbe 3 024-Byte-Datei der ICC.

Das eigentliche Größenproblem liegt woanders: **Font-Embedding ist Pflicht.**
Ob fast-pdf eine Schrift mitliefert oder eine verlangt, ist die wichtigste
Produktentscheidung an PDF/A-3b — nicht das XMP.

### 4. Rechtlich: 62 Tage bis zum nächsten Stichtag — aber PDF ist nicht gefordert

Ab **01.01.2027** gilt die Ausstellungspflicht für E-Rechnungen bei einem
Vorjahresumsatz über 800 000 € (§ 27 Abs. 38 S. 1 Nr. 2 UStG); ab **01.01.2028**
faktisch für alle. Frankreich ist seit **01.09.2026** live.

**Aber:** Das BMF-Schreiben vom 15.10.2025 stellt im UStAE ausdrücklich fest:
„Die zusätzliche Erstellung eines menschenlesbaren Dokuments ist **nicht
erforderlich**" (Abschn. 14.4 Abs. 3), und bei hybriden Formaten „bilden die im
strukturierten Teil vorliegenden Rechnungsdaten den **führenden Teil**". Eine
reine XRechnung erfüllt das Gesetz. **ZUGFeRD ist eine Markt-, keine
Rechtsanforderung.**

**PDF/UA hat gar keinen Stichtag**, der es namentlich fordert. Das BFSG gilt seit
28.06.2025, nennt aber weder EN 301 549 noch PDF/UA; PDF/UA steht nur in einer
**informativen Anmerkung** (EN 301 549 V4.1.1, Clause 10.0 NOTE 11: „would be
useful in meeting"). Und: das BFSG betrifft **B2C**-Dienstleistungen —
B2B-Rechnungs-PDFs fallen nicht darunter.

### 5. Die Marktlücke ist real, aber seit drei Wochen nicht mehr leer

Jedes JS-Paket fällt in genau eine von zwei Rollen: „erzeugt die Seiten" oder
„hängt XML an ein fertiges PDF". **Die zweite Gruppe kann PDF/A nicht
herstellen, nur konservieren** — die Python-Referenz sagt das seit Jahren selbst:
„fully PDF/A-3 compliant **when the input PDF file is PDF/A compliant**".

- **pdf-lib** (27,6 Mio. Downloads/Woche) ist der Unterbau fast aller
  ZUGFeRD-Pakete — und seit 2024-07-17 ohne Commit, ohne XMP, ohne PDF/A.
- **pdfkit** ist der einzige etablierte Generator mit nativem PDF/A — liest sein
  ICC-Profil aber per `fs.readFileSync` vom Dateisystem, was in Bundlern und Edge
  bricht (#1578, #1801), und kennt das Factur-X-XMP-Schema nicht (0 Repo-Treffer).
- **`@reportwright/pdf`** (13.10.2026, MIT, 0 Deps) ist die **einzige**
  dependency-freie Lösung mit committetem veraPDF-Nachweis — aber 2 Sterne,
  54 Downloads/Woche und ~85–175 KB min+gzip.

**Kein npm-Paket liefert ein sRGB-ICC-Profil, kein etablierter XMP-Writer
existiert.** Jede Library vendored beides selbst — eine (`@stackforge-eu/factur-x`)
vergisst das Profil ganz und erzeugt still ein ungültiges PDF/A-3b.

### 6. Validierung ist Teil des Features, nicht Bonus

Nach BMF-Schreiben vom 15.10.2025, Rn. 6a/6b, führt ein **Format- oder
Geschäftsregelfehler** dazu, dass die Datei die Anforderungen an eine E-Rechnung
**nicht erfüllt**. Eine schematisch ungültige ZUGFeRD-Datei ist rechtlich
wertlos.

Es gibt **keinen** JS-nativen PDF/A-Validator und keinen WASM-Port — eine JVM in
der CI ist unvermeidlich. Sie ist aber kostenlos: GitHub-`ubuntu-24.04`-Runner
bringen JDK 8/11/17/21/25 vorinstalliert mit. **veraPDF 1.30.3** (dual GPLv3+/MPLv2+,
in CI unkritisch) und **Mustang 2.26.0** (Apache-2.0, prüft PDF/A + XMP + XML +
Schematron in einem Aufruf) decken alles ab.

**Unabhängig von jeder ZUGFeRD-Entscheidung:** `qpdf --check` (Apache-2.0,
apt-Paket, < 100 ms/Datei) über die sechs Beispiel-PDFs in `examples/output/`
wäre heute ein sinnvolles Gate — die aktuellen Tests prüfen selbsterzeugte
Struktur gegen eigene Erwartungen und können diese Fehlerklasse strukturell nicht
finden.

## Aufwandsübersicht

> **Alle Zahlen sind Schätzungen**, keine Angebote. Annahme: eine erfahrene
> Person, die den Code kennt; inkl. Tests, exkl. Review und Doku-Politur.
> Herleitung jeweils im verlinkten Dokument.

| Block                                                                                                    | Personentage | Dokument                                    |
| -------------------------------------------------------------------------------------------------------- | -----------: | ------------------------------------------- |
| **CI-Grundlage** (Basis-Workflow, `qpdf`-Gate, Doku) — unabhängig von ZUGFeRD                            |         1,25 | [validatoren-ci](./validatoren-ci.md)       |
| veraPDF-Job + erste Befunde analysieren                                                                  |    1,25–1,75 | [validatoren-ci](./validatoren-ci.md)       |
| **PDF/A-3b-Container** (XMP, OutputIntent, Font-Zwang, Modus-Schalter, eingebettete Datei, veraPDF-grün) |    **11–22** | [pdfa3b](./pdfa3b-anforderungen.md)         |
| **ZUGFeRD-Aufsatz** (Factur-X-Metadaten, Profil-Matrix, Plausibilitätsprüfung, Testkorpus)               |  **3,5–5,5** | [zugferd-container](./zugferd-container.md) |
| Mustang-Validierung in CI                                                                                |     0,5–0,75 | [validatoren-ci](./validatoren-ci.md)       |
| **Summe: fast-pdf liefert den Container, XML kommt vom Aufrufer**                                        |   **~17–31** |                                             |
| _CII-/EN-16931-XML-Erzeugung, falls zusätzlich gewünscht_                                                |      _15–30_ | [zugferd-container](./zugferd-container.md) |

Die Spanne beim PDF/A-3b-Block ist breit, weil der erste veraPDF-Lauf
erfahrungsgemäß Befunde produziert, die man vorher nicht sehen kann (allein
3–8 PT sind dafür veranschlagt).

## Was diese Recherche nicht belegen konnte

Jedes Dokument hat einen eigenen Abschnitt „Nicht abschließend belegt". Die drei
Punkte, die eine Entscheidung am ehesten berühren:

1. **Die ZUGFeRD-/Factur-X-Spezifikation lag nicht vor.** FeRD hat 2.3.3 vom
   Download genommen; FNFE-MPE verlangt für 1.09.2 eine E-Mail-Adresse. Die
   BR-HYBRID-Regeln stammen aus einer Validator-Dokumentation
   (`phax/kaltblut`), gegengeprüft an zwei echten ZUGFeRD-PDFs. Für eine
   Entscheidung belastbar; **für eine Abnahme sollte die Spec beschafft werden.**
2. **Der ISO-19005-3-Normtext lag nicht vor** (kostenpflichtig). Klauselnummern
   und Regeltexte stammen aus dem veraPDF-Profil `PDFA-3B.xml`. Praktisch
   unkritisch, da veraPDF das Werkzeug ist, das im Zweifel „nein" sagt.
3. **Keine Laufzeiten gemessen.** Die Validator-Zeiten in
   [`validatoren-ci.md`](./validatoren-ci.md) sind Schätzungen auf Basis
   verifizierter Artefaktgrößen; die Ausführung der heruntergeladenen Java-Tools
   wurde von der Sandbox verweigert.

Ein vierter Punkt mit eigener Dringlichkeit: **Der Volltext der BT-Drs. 21/8283
(Jahressteuergesetz 2026) wurde nicht gelesen.** Eine Änderung an § 27 Abs. 38
UStG im Ausschussverfahren nach dem 08.10.2026 lässt sich damit nicht
ausschließen. Das wäre vor einer endgültigen Roadmap-Entscheidung primär zu
prüfen.

## Hinweis zu bestehenden Zusagen im Projekt

Das README wirbt im Abschnitt „Security" zusammen mit `SECURITY.md` damit, dass
erzeugte PDFs **keine eingebetteten Dateien** enthalten. Diese Zusage steht im
direkten Widerspruch zu PDF/A-3 und ZUGFeRD und müsste **umformuliert**, nicht
nur ergänzt werden. Die Härtung in `src/document/document.ts:760` und
`src/pdf/import.ts` (importierte PDFs dürfen keine Anhänge oder
`/JavaScript`-Aktionen einschleusen) bleibt davon unberührt und richtig.
