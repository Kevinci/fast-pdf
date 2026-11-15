# Stand der Technik — PDF/A-3 und ZUGFeRD im JS-Ökosystem

> Recherchestand: **30.10.2026**. Beantwortet Frage 7.
> Siehe auch [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md),
> [`zugferd-container.md`](./zugferd-container.md).

## Frage

Was machen vergleichbare JS-Libraries (pdf-lib, pdfkit, jsPDF, die
ZUGFeRD-Pakete, mustangproject)? Gibt es bereits eine **dependency-freie**
JS-Lösung für ZUGFeRD? Wenn ja: welche, wie groß, wie gepflegt?

## Kurzantwort

Seit **9./13. Oktober 2026** — also drei Wochen — existiert genau **eine**
dependency-freie JS/TS-Lösung, die ein gültiges PDF/A-3b mit eingebettetem
Factur-X-XML _schreibt_: **`@reportwright/pdf`** (MIT, 0 Runtime-Dependencies,
v1.1.1 vom 13.10.2026). Sie liefert sogar committete veraPDF-Reports
(146 Regeln bestanden, 0 fehlgeschlagen). Aber: 2 GitHub-Sterne, ~54 wöchentliche
Downloads, ~175 KB min+gzip — rund das Dreizehnfache von fast-pdf. Sie erzeugt
**nur den Container**, nicht das CII-XML. Für die _vollständige_ Kette gibt es
**keine** dependency-freie Lösung; alle geeigneten Pakete ziehen 2–8
Dependencies, meist `pdf-lib` plus einen WASM-XSD-Validator. Der strukturell
wichtigste Befund: **fast alle XML-Pakete setzen ein bereits PDF/A-taugliches
Eingangs-PDF voraus** — genau wie die Python-Referenz `factur-x`, deren Changelog
seit v0.5 sagt: „fully PDF/A-3 compliant **when the input PDF file is PDF/A
compliant**". Der harte Teil ist also nicht das Anhängen des XML, sondern die
PDF/A-Erzeugung selbst. Genau dort klafft die Lücke: Es gibt **kein** npm-Paket,
das ein sRGB-ICC-Profil ausliefert, und **keinen** etablierten XMP-Writer — jede
Library vendored beides selbst.

---

## Vergleichstabelle

| Paket                        | Version / Datum           | Lizenz                 |                               Deps |                  Größe min+gzip | XML?     | PDF/A-3?                         | Attachment?                           | XMP?                          | Wartung                                                    |
| ---------------------------- | ------------------------- | ---------------------- | ---------------------------------: | ------------------------------: | -------- | -------------------------------- | ------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| **pdf-lib**                  | 1.17.1 / 2021-11-06       | MIT                    |                                  4 |                       177 487 B | nein     | **nein**                         | ja (`attach()`, `afRelationship`)     | **nein**                      | letzter Push 2024-07-17, 318 offene Issues, 8 662 ★        |
| **@cantoo/pdf-lib** (Fork)   | 2.11.1 / 2026-09-15       | MIT                    |                                  4 |                      n. erhoben | nein     | nicht belegt                     | ja (geerbt)                           | n. belegt                     | Push 2026-09-11, 358 ★                                     |
| **pdfkit**                   | 0.20.2 / 2026-08-30       | MIT                    |                                  6 |                       212 327 B | nein     | **ja** (`subset: 'PDF/A-3b'`)    | **ja** (`doc.file()`, `relationship`) | **ja** (`pdfaid`; kein `fx:`) | Push 2026-10-26, 10 728 ★                                  |
| **jsPDF**                    | 4.2.1 / 2026-03-17        | MIT                    |                                  3 |                       129 768 B | nein     | **nein** (#2882 offen seit 2020) | **nein**                              | **ja** (`addMetadata`)        | Push 2026-10-28, 31 318 ★                                  |
| **node-zugferd**             | 0.1.1-beta.1 / 2025-08-07 | MIT                    |                        4 (+1 opt.) |                       194 039 B | **ja**   | anreichernd                      | ja                                    | ja (inkl. `fx:`)              | Beta, Push 2026-07-31, 75 ★                                |
| **@stackforge-eu/factur-x**  | 1.4.3 / 2026-09-28        | **EUPL-1.2**           |                                  2 |                       186 345 B | **ja**   | ja — **aber ohne ICC**           | ja                                    | ja (inkl. `fx:`)              | Push 2026-10-06, 0 offene Issues, 19 ★                     |
| **@stafyniaksacha/facturx**  | 0.6.1 / 2026-08-28        | MIT (npm) / GH: _kein_ | 6 (inkl. **saxon-js**, proprietär) |                      n. erhoben | **ja**   | ja                               | ja                                    | ja                            | Push 2026-10-26, 25 ★                                      |
| **@lucaapp/zugferd-ts**      | 0.1.0 / 2026-06-13        | Apache-2.0             |                   6 (ohne pdf-lib) |                      n. erhoben | **ja**   | ja (eigener Container-Code)      | ja                                    | ja (inkl. `fx:`)              | ein Release, kein Repo-Feld                                |
| **@e-invoice-eu/core**       | 3.4.2 / 2026-10-22        | WTFPL                  |                                  8 |                       525 871 B | **ja**   | ja                               | ja                                    | ja                            | Push 2026-10-30, 367 ★                                     |
| **zugferd-client**           | 0.1.1 / 2026-10-21        | MIT                    |                              **0** |                      n. erhoben | —        | —                                | —                                     | —                             | **REST-Client für eine Cloud-API**, kein lokaler Generator |
| **@reportwright/pdf**        | 1.1.1 / 2026-10-13        | MIT                    |                              **0** | 174 869 B (Writer-Entry ~85 KB) | **nein** | **ja, veraPDF-belegt**           | ja (`pdf.attach`)                     | ja (inkl. `fx:`)              | Paket 3 Wochen alt, 2 ★, 54 DL/W                           |
| **mustangproject** (Java)    | Push 2026-10-28           | Apache-2.0             |                           (PDFBox) |                               — | **ja**   | **ja + Konvertierung**           | ja                                    | ja                            | 489 ★                                                      |
| **factur-x** (Python)        | Push 2026-10-30           | GH: NOASSERTION        |                        pypdf, lxml |                               — | **ja**   | nur wenn Input schon PDF/A       | ja                                    | ja                            | 314 ★                                                      |
| **fast-pdf** (zum Vergleich) | 0.8.1                     | MIT                    |                              **0** |                      **~13 KB** | nein     | **nein**                         | nein                                  | **nein**                      | aktiv                                                      |

Wöchentliche Downloads (npm Downloads-API, 23.–29.10.2026): pdf-lib 27 588 556 ·
jsPDF 20 215 290 · pdfkit 15 240 531 · node-zugferd 48 347 ·
@stackforge-eu/factur-x 44 909 · @e-invoice-eu/core 34 928 ·
@stafyniaksacha/facturx 5 327 · @lucaapp/zugferd-ts 2 957 ·
zugferd-client 59 · @reportwright/pdf 54.

---

## 1. pdf-lib — faktisch unmaintained, kein PDF/A

**v1.17.1, veröffentlicht 2021-11-06**, letzter Commit **2024-07-17**, 318 offene
Issues, 8 662 ★. MIT, 4 Dependencies.

**Was geht:** Embedded Files via `doc.attach()` (Issue #229, geschlossen). Das
`afRelationship`-Feld und der `/AF`-Katalogeintrag kamen über **PR #508
„Additional support for factur-x (PDF-A3)"** (29.06.2020 – 29.11.2020); Hopding
am 06.12.2020: „The changes in this PR were just released in `v1.13.0`."

**Was fehlt:**

- **XMP:** nicht unterstützt — belegt durch **PR #1708 „docs: Explain that XMP
  Metadata streams are not supported"** (03.12.2024, gemerged 02.01.2026).
  `setTitle()` schreibt nur das Info-Dictionary.
- **OutputIntent / ICC:** keine API.
- **PDF/A-Modus:** keiner. Issue **#230 „Generate PDF/A-3 documents"**
  (01.11.2019) wurde 2021-09-24 geschlossen mit „Added this to the roadmap for
  tracking: discussions/998" — seitdem nichts. Issue **#1183 „Convert in PDF/A"**
  ist seit **03.03.2022 offen**.
- **#1760** „embedding files via `attach()` should not compress by default"
  (offen seit 24.09.2025) — direkt relevant für ZUGFeRD-Anhänge.

Ein Community-Kommentar in #1183 (13.10.2026) fasst es zusammen: „pdf-lib can't
produce PDF/A: that needs an XMP identification block, an output intent with an
ICC profile, embedded fonts only and no transparency or encryption, and there's
no converter in the library."

Gepflegter Fork: **`@cantoo/pdf-lib` 2.11.1** (358 ★), u. a. von
`@e-invoice-eu/core` genutzt. Ob er XMP/PDF/A kann: **nicht geprüft**.

## 2. pdfkit — der stärkste Incumbent, PDF/A ist eingebaut

**v0.20.2, 2026-08-30**, MIT, 6 Dependencies, 212 327 B min+gzip, 10 728 ★,
Push 26.10.2026 — klar aktiv.

**PDF/A: ja, nativ.** Option `subset` mit `'PDF/A-1'|…|'PDF/A-3b'|'PDF/A-3a'`,
dazu `pdfVersion` und `tagged: true` für Level A.
`lib/mixins/pdfa.js` schreibt genau zwei Dinge: den
`pdfaid:part`/`pdfaid:conformance`-XMP-Block (`_getPdfaid()`) und den OutputIntent
(`_addColorOutputIntent()`, `S: 'GTS_PDFA1'`, `N: 3`, `OutputConditionIdentifier`
= `'sRGB IEC61966-2.1'`) mit der mitgelieferten Datei
`data/sRGB_IEC61966_2_1.icc`.

**Attachments: ja, PDF/A-3-tauglich.** `doc.file(src, opts)` mit Option
**`relationship`** (`'Alternative' | 'Data' | 'Source' | 'Supplement' |
'Unspecified'`). Kam aus Issue **#1561 „Improve PDF/A compliance"**
(31.10.2024) — eröffnet mit: „I had the need to implement Facture-x/ZUGFeRD
compliant PDF for invoicing" — umgesetzt via **PR #1562**.

**Von veraPDF getriebene Fixes 2026:**

- **PR #1704** „Generate a PDF/A compliant CIDSet instead of using hardcoded
  FFFFFFFFC0" (17.03.2026) — gegen veraPDF-Regel 6.3.5-3.
- **PR #1703** „PDF/A-1 compliance fails due to document's Producer mismatch
  XMP Metadata pdf:Producer" (17.03.2026) — gegen ISO 19005-1 Klausel 6.7.3 Test 7.

**Zwei konkrete Lücken:**

1. **Kein Factur-X-XMP-Extension-Schema.** Code-Suche im Repo nach `factur`,
   `zugferd`, `DocumentFileName`, `ConformanceLevel` → **0 Treffer**. Der
   `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`-Namespace samt
   `pdfaExtension:schemas`-Deklaration muss per `appendXML()` von Hand
   nachgereicht werden.
2. **Das ICC-Profil wird vom Dateisystem gelesen:**
   `fs.readFileSync(new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url))`.
   Das bricht in Next.js, Bundlern und Edge — Issue **#1578 „PDF/A ICC profile
   not bundled"** (02.01.2025), Workaround `serverExternalPackages: ['pdfkit']`;
   dazu **#1801**. **Für fast-pdf, das ausdrücklich Browser/Edge/Deno bedient,
   ist das die lehrreichste Fehlerquelle der ganzen Recherche:** ein ICC-Profil
   gehört als Byte-Array in den Code, nicht als Datei neben den Code.

## 3. jsPDF — XMP ja, PDF/A und Attachments nein

**v4.2.1, 2026-03-17**, MIT, 3 Deps, 129 768 B min+gzip, 31 318 ★.

- **XMP: ja.** `src/modules/xmp_metadata.js` (aus PR #764 zu Issue #763).
  `addMetadata(metadata, namespaceuri)` schreibt ein echtes
  `<< /Type /Metadata /Subtype /XML >>`-Objekt.
- **PDF/A: nein.** Issue **#2882 „Generate PDF/A compliant document"** ist seit
  **27.08.2020 offen**.
- **Attachments: nein.** Code-Suche nach `EmbeddedFiles` und `Filespec` → **0
  Treffer**. (`addFileToVFS` ist ein virtuelles Dateisystem für Fonts.)

→ jsPDF ist für ZUGFeRD strukturell **nicht** verwendbar.

## 4. Die ZUGFeRD-/Factur-X-Pakete

**Existieren wirklich:** `node-zugferd`, `@stackforge-eu/factur-x`,
`@stafyniaksacha/facturx`, `@lucaapp/zugferd-ts`, `@e-invoice-eu/core`,
`zugferd-client`, `factur-x` (0.0.2), `zugferd` (0.0.1).
**Existieren NICHT:** `@zugferd/core`, `facturx`, `zugferd-js`, `node-facturx`
(alle 404 in der npm-Registry).
**Tote Platzhalter:** `zugferd` 0.0.1 (2024-05-29, 1 420 B, „:construction: Under
development") und `factur-x` 0.0.2 (2024-08-30, kein Repo).

### `node-zugferd`

**v0.1.1-beta.1, 2025-08-07**, MIT, 75 ★, Push 31.07.2026. Deps: `defu`,
`fast-xml-parser`, `pdf-lib ^1.17.1`, `zod`; dazu
`optionalDependencies: { "xsd-schema-validator": "^0.10.0" }` — das ist
`nikku/node-xsd-schema-validator` und **braucht ein installiertes JDK/`javac`**.

Macht beides: `invoice.toXML()` und `invoice.embedInPdf(pdfBytes, {metadata})`.

**Wie es PDF/A-3 herstellt** (aus `dist/index.js` der veröffentlichten Version) —
eine Kette von Mutationen auf einem _vorhandenen_ PDF:

- `addPdfICC()`: dekodiert eine **inline base64-Konstante** (3 024 Bytes, Header
  `mntr`/`RGB `/`acsp`, Strings `sRGB2014`, „Copyright International Color
  Consortium, 2015") und registriert sie als `DestOutputProfile` in einem
  OutputIntent mit `S: 'GTS_PDFA1'`.
- `addPdfMarkInfo`: `/MarkInfo << /Marked true >>`.
- `addPdfStructTreeRoot`: ein **leerer** `/StructTreeRoot` (nur `Type`) — ein
  Minimal-Hack, kein echter Strukturbaum.
- `fixPdfLinkAnnotations`: setzt das `/F`-Flag `|4` (Print) auf Link-Annotationen.
  **Exakt der Befund F1 aus [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md)**
  — ein anderes Projekt ist über dieselbe Regel `[6.3.2-1]` gestolpert.
- XMP mit `pdfaid` und `fx:`-Extension-Schema; `AFRelationship` am Anhang.

**Auffälligkeit:** Der ICC-Stream wird **ohne `/N 3`** angelegt — anders als
pdfkit, `@stackforge-eu/factur-x` und `@reportwright/pdf`. Ob veraPDF darüber
stolpert, ist **nicht geprüft**.

**Grenze, vom README selbst benannt:** „The data in your pdf must exactly match
the provided data!" — es erzeugt die sichtbare Rechnung nicht, es reichert ein
fertiges PDF an. Fonts, Transparenz und Farbräume im Seiteninhalt bleiben
unangetastet.

### `@stackforge-eu/factur-x`

**v1.4.3, 2026-09-28**, **EUPL-1.2** (Copyleft — für ein MIT-Projekt relevant),
nur 2 Deps: `pdf-lib` + `libxml2-wasm`. 19 ★, 0 offene Issues, 44 909 DL/W.
Profile MINIMUM … EXTENDED, Flavors Factur-X/ZUGFeRD/XRechnung, CII-Generierung
(Factur-X 1.09 / ZUGFeRD 2.5), **XSD-Validierung via WASM**, Einbettung,
Extraktion.

**Der kritischste Einzelbefund der Recherche** (aus `dist/index.js`, Funktion
`embedFacturX`): Das Paket **liefert kein ICC-Profil mit** (kein `.icc` im
Tarball). Der OutputIntent entsteht nur, wenn der Aufrufer `rgbIccProfile`
übergibt — sonst eine `console.warn` und ein PDF **ohne OutputIntent**, also
**kein gültiges PDF/A-3b**. Ebenso: `findUnembeddedFonts()` _erkennt_ nicht
eingebettete Fonts, kann sie aber nicht einbetten (Default `'warn'`). Das README
enthält keinen Limitations-Abschnitt, der das benennt.

### `@stafyniaksacha/facturx`

v0.6.1, 2026-08-28. npm-Lizenz MIT, **GitHub-Lizenzfeld `null`** — widersprüchlich.
25 ★, 5 327 DL/W. Deps enthalten **`saxon-js`**, das **proprietär (Saxonica)** ist
— für ein MIT/Apache-Projekt ein Lizenzthema.

### `@lucaapp/zugferd-ts` — die am besten belegte XML-Seite

**v0.1.0, 2026-06-13**, **Apache-2.0**, 6 Deps, **kein `pdf-lib`** (eigener
Container-Code). 2 957 DL/W, **kein `repository`-Feld**, nur ein Release.

XML + `embedXml()` → PDF/A-3b + `extractXml` + XSD (`xmllint-wasm`) +
**EN-16931-Schematron** (`node-schematron`, pure JS) + einen hauseigenen
`verapdf-lite` (~22-Regel-Subset). Bundelt ebenfalls sRGB2014.

**Compliance-Evidenz im README:** Mustangproject CLI 2.23.1 → `XML:valid`,
PDF/A-3b `isCompliant=true`; EU-ITB/EN16931-Referenzvalidator → `SUCCESS`.
Das ist die sauberste externe Validator-Evidenz aller JS-Pakete — allerdings
**README-Behauptungen ohne committete Artefakte**.

**Lizenz-Detail mit Vorbildcharakter:** Die KoSIT-BR-DE-Regeln bräuchten
`saxon-js`; das Projekt führt es bewusst nur als `devDependency`, weil es
„proprietary (Saxonica) and therefore cannot be bundled with this Apache-2.0
library" sei. Genau das Problem, das `@stafyniaksacha/facturx` ungelöst in die
Runtime-Dependencies nimmt.

### `@e-invoice-eu/core` und `zugferd-client`

`@e-invoice-eu/core` v3.4.2, WTFPL, 8 Deps, **525 871 B min+gzip** — das größte
Paket im Feld; eher Pipeline als Bibliothek.
`zugferd-client` v0.1.1 hat zwar **0 Dependencies**, ist aber ein **REST-Client
für eine gehostete API** und erzeugt lokal nichts. Nicht auf „zero dependencies"
hereinfallen.

## 5. mustangproject (Java) — die vollständige Referenz

Apache-2.0, 489 ★, Push 28.10.2026. „Embeddable java library based on PDFbox."
Deckt als **Einziges alle vier** Aufgaben ab: XML lesen/schreiben ·
PDF-Einbettung · **PDF/A-Konvertierung** („Convert PDF/A-1 to PDF/A-3") ·
Validierung (EN-16931-Schematron + veraPDF). `@lucaapp/zugferd-ts` nutzt es
selbst als Gegenprobe. Siehe auch [`validatoren-ci.md`](./validatoren-ci.md).

## 6. Python-Vergleich: `factur-x` (Akretion) — der aufschlussreichste Befund

GitHub `akretion/factur-x`, 314 ★, Push 30.10.2026.

- **Kein Ghostscript, kein externes Binary.** Der einzige externe Dienst im
  Changelog ist ein **Saxon-Server für Schematron** (ab v6.0) — das betrifft die
  XML-Prüfung, nicht den PDF-Teil.
- PDF-Bibliothek: **pypdf**; XMP über **lxml**.
- **Der Kernsatz, Changelog v0.5:** „Now fully PDF/A-3 compliant **when the input
  PDF file is PDF/A compliant** (tested with veraPDF). This implied copying
  `/OutputIntents` and `/ID` datas from source PDF to Factur-X PDF."

**Interpretation:** Die Referenzimplementierung erzeugt PDF/A **nicht** — sie
_erbt_ es, indem sie `/OutputIntents` und `/ID` aus dem Eingangs-PDF kopiert. Der
schwere Teil (eingebettete Fonts, OutputIntent + ICC, XMP-Identifikation) wird
vollständig an den Erzeuger des Eingangs-PDFs delegiert. Dieselbe Arbeitsteilung
findet sich in `node-zugferd`, `@stackforge-eu/factur-x`,
`@stafyniaksacha/facturx` und `@lucaapp/zugferd-ts`. Ghostscript (`-dPDFA=2`)
taucht in der Praxis als externe Vorstufe auf — aber **nicht** als Dependency von
`factur-x` selbst.

## 7. Kernfrage: Gibt es eine dependency-freie JS-Lösung?

**Für den PDF/A-3b-Container allein: ja, seit drei Wochen — mit Vorbehalten.**

**`@reportwright/pdf`**, npm v1.1.1, **veröffentlicht 2026-10-13** (Paket angelegt
2026-10-09), **MIT**, **`"dependencies": {}`**. ESM-only, Node ≥ 20.16 + moderne
Browser, WebCrypto. `fflate` ist **nicht** Dependency, sondern als
`dist/fflate.js` mitgebundelt und lazy geladen.

**Größe** (drei Quellen, die auseinandergehen):

- Bundlephobia v1.1.1: 467 169 B min / **174 869 B min+gzip**, 0 Deps.
- README-Tabelle: `.` 133,4 KiB, `./write` (nur Writer) **85,0 KiB**.
- Eigene `gzip -9`-Messung am Tarball: `index.js` 183 707 B,
  `write.js` **84 764 B**.

→ Realistisch **~85 KB min+gzip für den reinen Writer-Pfad**, ~175 KB für alles.
Gegenüber fast-pdf (~13 KB) Faktor ~6,5 bzw. ~13.

**API:**

```js
const pdf = createPdf(sink, {
  title: "Invoice INV-2026-001",
  pdfa: { part: 3, conformance: "a" },
  tagged: { lang: "en" },
});
// … Rechnung zeichnen …
await pdf.facturX(xmlBytes, { profile: "EN 16931" });
```

**Validator-Nachweis — committet und reproduzierbar.** `conformance/README.md`
im Repo `MrArun005/reportwright-pdf`: veraPDF 1.30.0, Lauf vom **2026-10-09**,
mit maschinenlesbaren `--format json`-Reports im Repo. Aus
`conformance/pdfa-3b-facturx.3b.json`:

> `"passedRules": 146, "failedRules": 0, "passedChecks": 1070,
"failedChecks": 0, "compliant": true`, `"profileName": "PDF/A-3b validation
profile"`, Datei `pdfa-3b-facturx.pdf` (17 694 B).

Weitere Level: 1b (129/0), 2b (144/0), 2u (146/0), 2a (153/0 + UA-1 106/0),
3u (148/0), 3a (155/0 + UA-1 106/0).

> **Die Zahl 146 ist die Gegenprobe zu unserer eigenen Analyse:** Das
> veraPDF-Profil `PDFA-3B.xml` enthält 146 Regeln — genau die Zahl, die wir in
> [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) selbst ausgezählt haben.
> Die beiden Recherchestränge stimmen überein.

**Wie es das ICC-Problem dependency-frei löst** — technisch der interessanteste
Punkt: statt der 3 024-Byte-Datei `sRGB2014.icc` inlinet es eine **736 Byte
große, mit Little CMS erzeugte** sRGB-v2-Profildatei als base64-Konstante
(verifiziert aus `dist/write.js`: 984 base64-Zeichen → 736 Bytes, CMM `lcms`,
Class `mntr`, Space `RGB `, Signatur `acsp`). Der Profilstream trägt `<< /N 3 >>`.
Ein eigenes Profil kann über `pdfa.outputIntent` übergeben werden (geprüft auf
`acsp`, Version 2–4, Klasse `prtr`/`mntr`, Space RGB/CMYK).

> Die in [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) empfohlene
> CC0-Variante `sRGB-v2-micro.icc` ist mit **456 Bytes noch kleiner** und
> rechtlich eindeutig — derselbe Lösungsweg, aber ohne eigene Profilerzeugung.

**Was es NICHT tut** (README „Known limits", wörtlich): „no PDF/A-1a or PDF/X;
no attachment annotations in PDF/A-3 (use `pdf.attach`); a Factur-X invoice's
content is not validated." Außerdem: **es konvertiert keine bestehenden PDFs** und
**erzeugt kein CII-XML**.

**Reifegrad-Risiko, ungeschönt:** Paket drei Wochen alt. Repo angelegt
2026-10-10, **2 Sterne**, 1 Fork, 1 offene Issue. **54 Downloads/Woche.** Bekannt
geworden durch einen Selbstvermarktungs-Kommentar des Autors in pdf-lib #1183
(13.10.2026, mit offengelegter Disclosure). Die veraPDF-Reports sind selbst
erzeugt — aber im Repo abgelegt und mit dokumentiertem Reproduktionsbefehl, was
deutlich mehr ist als jedes andere JS-Paket bietet.

**Fazit:** Für **Konvertierung eines bestehenden PDFs** nach PDF/A-3b mit
Factur-X gibt es **keine** JS-Lösung — mit oder ohne Dependencies; nur
Mustangproject (Java) kann das. Für **Erzeugung** gibt es seit Oktober 2026 genau
eine dependency-freie Option mit Validator-Nachweis, aber ohne Marktreife und bei
6- bis 13-facher Codegröße von fast-pdf.

## 8. Nebenfrage: XMP-Writer und ICC-Profile als npm-Pakete

**ICC-Profile als npm-Paket: es gibt keines.** Registry-Abfragen:
`icc-profiles`, `icc-profiles-adobe`, `srgb`, `srgb-icc-profile` → **alle 404**.
Das einzige relevante Paket **`icc` v4.0.0** (2026-04-23, Apache-2.0, 0 Deps) ist
ein reiner **Parser**, kein Profil-Lieferant.

**Folglich vendored jede Library das Profil selbst — dreimal dieselbe Datei:**

| Projekt                         | Profil                                                                                                  |     Größe |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | --------: |
| pdfkit                          | `lib/data/sRGB_IEC61966_2_1.icc` (Strings `sRGB2014`, „Copyright International Color Consortium, 2015") |   3 024 B |
| node-zugferd                    | dieselbe Datei, inline base64                                                                           |   3 024 B |
| @lucaapp/zugferd-ts             | ebenfalls sRGB2014                                                                                      |         — |
| @stackforge-eu/factur-x         | **keins**                                                                                               |         — |
| @reportwright/pdf               | selbst mit Little CMS erzeugt                                                                           |     736 B |
| _(Empfehlung dieser Recherche)_ | `sRGB-v2-micro.icc`, **CC0 1.0**                                                                        | **456 B** |

**Bemerkenswert:** pdfkits `LICENSE`, `NOTICE` und `README.md` enthalten **keine**
Herkunfts- oder Lizenzangabe zum mitgelieferten ICC-Profil — obwohl im selben
Repo Issue **#1793** (26.10.2026) exakt solche Attributionsfragen für
`@pdf-lib/fontkit` aufwirft. Wer ein Fremdprofil bündelt, erbt diese Frage.

**XMP-Writer als npm-Paket: es gibt keinen etablierten.** `xmp-writer`, `xmpjs`,
`node-xmp`, `fast-xmp` → **404**. `xmp-js` v0.0.5 **liest** nur XMP aus JPEG.
`exiftool-vendored` umschließt das Perl-Binary ExifTool — in Edge/Browser/Deno
unbrauchbar. In **allen** untersuchten PDF-Bibliotheken wird das XMP-RDF **von
Hand als Template-String** zusammengesetzt.

---

## Marktlücke — was das für fast-pdf heißt (Befund, keine Empfehlung)

1. **Die Zweiteilung ist das Marktbild.** Jedes JS-Paket fällt in genau eine von
   zwei Rollen: „erzeugt die Seiten" (pdfkit, jsPDF, pdf-lib, fast-pdf) oder
   „hängt XML an ein fertiges PDF" (node-zugferd, stackforge, stafyniaksacha,
   luca, factur-x/Python). **Die zweite Gruppe kann PDF/A-Konformität nicht
   herstellen, nur konservieren** — sie erreicht Fonts, Farbräume und Transparenz
   im Seiteninhalt gar nicht. Wer beide Rollen in einem Prozess hat, löst ein
   Problem, das die Anhänge-Pakete prinzipiell nicht lösen können.
2. **pdfkit ist der einzige etablierte JS-Generator mit nativem PDF/A** — mit zwei
   scharf benennbaren Schwächen: ICC via `fs.readFileSync` (bricht in
   Bundlern/Edge, #1578/#1801) und kein Factur-X-XMP-Extension-Schema (0
   Repo-Treffer). 212 KB min+gzip, 6 Dependencies.
3. **pdf-lib ist der De-facto-Unterbau fast aller ZUGFeRD-Pakete und ist tot.**
   Drei der fünf ZUGFeRD-Pakete bauen auf einer fünf Jahre alten Version auf, die
   weder XMP (#1708) noch PDF/A (#230, #1183) kann — und bauen die fehlenden
   Teile in vier unabhängigen Kopien selbst nach.
4. **ICC und XMP sind im JS-Ökosystem ungelöste Infrastruktur.** Kein npm-Paket
   liefert ein sRGB-Profil, kein etablierter XMP-Writer existiert. Vier Projekte
   vendoren dieselbe 3 024-Byte-Datei, **eines vergisst sie ganz** und erzeugt
   damit still ein ungültiges PDF/A-3b.
5. **Der Größenmaßstab.** Alle PDF/A-fähigen Kandidaten liegen zwischen 175 KB
   und 526 KB min+gzip; der kleinste dependency-freie Writer-Pfad ist ~85 KB.
   fast-pdfs ~13 KB liegt eine Größenordnung darunter. Was PDF/A-3b mindestens
   zusätzlich kostet: ein ICC-Profil (456 B CC0), ein XMP-RDF-Template mit
   `pdfaid` + Factur-X-Extension-Schema (~2–3 KB Quelltext), ein
   OutputIntent-Objekt, `/AF` + `AFRelationship`, `/ID` im Trailer — plus die
   Zusage „nur eingebettete Fonts, keine Verschlüsselung".
6. **Nachfragesignal.** pdf-lib #230/#1183 laufen seit 2019 bzw. 2022 ohne
   Lösung, mit wiederholten „gibt es ein Beispiel?"-Kommentaren bis 13.10.2026.
   pdfkit #1561 wurde explizit mit dem ZUGFeRD-Bedarf eröffnet. 2026 sind vier
   neue ZUGFeRD-Pakete erschienen bzw. stark gewachsen — plausibel getrieben von
   der deutschen E-Rechnungspflicht (siehe
   [`stichtage-rechtslage.md`](./stichtage-rechtslage.md)).
7. **Belegkultur als Differenzierer.** Nur zwei Pakete zeigen überhaupt
   Validator-Evidenz: `@reportwright/pdf` (committete veraPDF-JSON-Reports samt
   Reproduktionsbefehl) und `@lucaapp/zugferd-ts` (README-Angaben zu Mustangproject
   und EU-ITB). **Alle anderen behaupten PDF/A-3b ohne Nachweis.**

---

## Nicht abschließend belegt

- **Bundle-Größen** stammen aus der Bundlephobia-API, nicht aus eigenen Builds;
  nur für `@reportwright/pdf` wurde zusätzlich `gzip -9` auf den Tarball
  angewendet. Die drei Größenquellen dafür widersprechen sich um bis zu 30 %.
- **Downloadzahlen** sind Primärdaten für eine einzelne Woche (23.–29.10.2026),
  nicht saisonbereinigt, Bots eingeschlossen.
- Ob der fehlende `/N`-Eintrag im ICC-Stream von `node-zugferd` tatsächlich zu
  einem veraPDF-Fehlschlag führt: **nicht geprüft**. Die Code-Beobachtung selbst
  ist belegt.
- Ob `@cantoo/pdf-lib` inzwischen XMP oder PDF/A kann: **nicht geprüft**.
- Die veraPDF-Ergebnisse von `@reportwright/pdf` sind **vom Projekt selbst
  erzeugt** und wurden nicht nachvollzogen; verifiziert ist nur, dass die
  JSON-Reports im Repo liegen und `compliant: true` enthalten. Die
  Compliance-Angaben von `@lucaapp/zugferd-ts` sind **README-Behauptungen ohne
  committete Artefakte**.
- Die genaue Lizenzfassung des `sRGB2014.icc` ist nicht im Volltext belegt;
  belegt ist nur der Copyright-Tag-Inhalt der ausgelieferten Datei.
- `@lucaapp/zugferd-ts` hat **kein `repository`-Feld**; Quellcode-Aussagen
  stammen aus dem npm-Tarball. Wartungszustand nur eingeschränkt beurteilbar.
- Die Lizenz von `@stafyniaksacha/facturx` ist **widersprüchlich**: npm meldet
  MIT, die GitHub-API `license: null`.
- Die GitHub-REST-API lief während der Recherche ins Rate-Limit; einige
  Repo-Details wurden **nicht** erhoben. Der MCP-GitHub-Server dieser Session war
  nicht verbunden („Authorization header is badly formatted").
- `mustangproject`-Angaben stammen aus Website und GitHub-API, nicht aus dem
  Quellcode (anders als in [`validatoren-ci.md`](./validatoren-ci.md), wo
  `PDFValidator.java` direkt gelesen wurde).

## Quellen

**npm-Registry / Downloads-API / Bundlephobia (Primärdaten)**

- `https://registry.npmjs.org/<paket>` für alle oben genannten Pakete
- `https://api.npmjs.org/downloads/point/last-week/<paket>`
- `https://bundlephobia.com/api/size?package=<paket>`

**pdf-lib**

- <https://github.com/Hopding/pdf-lib> · Issues /229 · /230 · /508 · /1183 · /1708 · /1760 · Discussion /998

**pdfkit**

- <https://github.com/foliojs/pdfkit> · <https://pdfkit.org/docs/getting_started.html>
- `lib/mixins/pdfa.js` · `docs/attachments.md` · `CHANGELOG.md`
- Issues/PRs: /1147 · /1561 · /1578 · /1793 · /1801 · /1803 · /pull/1485 · /1562 · /1703 · /1704
- <https://unpkg.com/pdfkit@0.20.2/js/data/sRGB_IEC61966_2_1.icc>

**jsPDF**

- <https://github.com/parallax/jsPDF> · `src/modules/xmp_metadata.js` · Issues /763 · /2882 · PR /764

**ZUGFeRD-/Factur-X-Pakete**

- <https://github.com/jslno/node-zugferd> (+ `dist/index.js` aus Tarball 0.1.1-beta.1)
- <https://github.com/StackForge-EU/factur-x> (+ `dist/index.js` aus Tarball 1.4.3)
- <https://github.com/stafyniaksacha/facturx> · <https://github.com/gflohr/e-invoice-eu>
- `@lucaapp/zugferd-ts` README und `dist/` aus Tarball 0.1.0
- <https://github.com/nikku/node-xsd-schema-validator> (JDK-Anforderung)

**@reportwright/pdf**

- <https://github.com/MrArun005/reportwright-pdf> · `conformance/README.md` · `conformance/pdfa-3b-facturx.3b.json`
- <https://unpkg.com/@reportwright/pdf@1.1.1/README.md> · `dist/write.js` aus Tarball 1.1.1

**Java / Python**

- <https://github.com/ZUGFeRD/mustangproject> · <https://www.mustangproject.org/>
- <https://github.com/akretion/factur-x> · <https://raw.githubusercontent.com/akretion/factur-x/master/README.rst>

**ICC / XMP**

- <https://color.org/chardata/rgb/srgb.xalter> · <https://registry.color.org/rgb-registry/srgb>
- <https://www.npmjs.com/package/icc>
