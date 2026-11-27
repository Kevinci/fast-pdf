# Release 1.0.0 — Scope, Reihenfolge, Begründung

> Entscheidungsdokument des Projektleiters. Stand: 2026-10-30, Basis 0.8.1.
> Die Langfrist-Roadmap (`docs/README.md`, Phasen v1.0 → v3.0) bleibt bestehen;
> dieses Dokument hat für alles, was 1.0.0 betrifft, Vorrang und korrigiert sie,
> wo sie überholt ist.

---

## 0. Entscheidung in einem Absatz

**1.0.0 erscheint ohne ZUGFeRD/Factur-X.** Der Inhalt von 1.0.0 ist: die
dokumentierten Zusagen wieder wahr machen, CI aufsetzen, die öffentliche API
bewusst schneiden und einfrieren, die Ausgabe gegen einen externen Prüfer
validieren. **~8,5 PT.** ZUGFeRD kommt in **1.1.0** hinter dem Subpath-Export
`fast-pdf/zugferd`, als **Container ohne XML-Erzeugung**, Profil EN 16931,
PDF/A-**3b**. **15–28 PT.**

Die Arbeitshypothese wird damit **getragen — aber mit anderer Begründung und
größerem 1.0.0-Scope als angenommen.** Siehe §1.

Zwei Befunde haben die Lage gegenüber der Ausgangsannahme verschoben:

- **Das ICC-Profil ist kein Problem.** 456 Bytes, CC0 — der vermutete
  Konflikt mit der Bundle-Zusage existiert nicht. Der echte Konflikt ist die
  **Schrift** (§3, Konflikt B).
- **ZUGFeRD ist keine Rechtspflicht.** Das BMF stellt klar, dass ein
  menschenlesbares Dokument gar nicht erforderlich ist; eine reine XRechnung
  erfüllt das Gesetz. fast-pdf steht auf niemandes Compliance-Pfad — der
  Stichtag 01.01.2027 ist Marktdruck, kein Haftungsrisiko (§5).

**Grundlagen:** [`research/README.md`](research/README.md) (Einstieg) ·
[`research/pdfa3b-anforderungen.md`](research/pdfa3b-anforderungen.md) ·
[`research/zugferd-container.md`](research/zugferd-container.md) ·
[`research/validatoren-ci.md`](research/validatoren-ci.md) ·
[`research/stichtage-rechtslage.md`](research/stichtage-rechtslage.md) ·
[`research/stand-der-technik-js.md`](research/stand-der-technik-js.md)

---

## 1. Zur Arbeitshypothese

Die Hypothese lautete: 1.0.0 ohne ZUGFeRD, weil das Release sonst an einer
Normrecherche hängt; Inhalt 1.0.0 = CI, API-Freeze, externe Validierung.

**Richtung: ja. Begründung: so nicht. Scope: zu klein.**

### Die Normrecherche ist nicht der Grund

Die Recherche läuft und ist in Stunden erledigt, nicht in Wochen (Ergebnis:
`docs/research/`). Wer ZUGFeRD allein wegen der Recherchedauer verschiebt,
hätte es nach der Recherche sofort wieder auf dem Tisch — mit demselben
Streit.

Der tragfähige Grund ist ein anderer: **ZUGFeRD erzwingt PDF/A-3b, und
PDF/A-3b ist mit dem heutigen Standardverhalten von fast-pdf unvereinbar.**
Zwei harte Kollisionen, beide im Code nachgewiesen:

| Kollision                                                                                                                  | Norm             | Nachweis im Code                                                                                                   | Folge                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| PDF/A verlangt **alle Schriften eingebettet**. fast-pdf schreibt standardmäßig nicht-eingebettete Standard-14-Type1-Fonts. | `[6.2.11.4.1-1]` | `src/fonts/font.ts:76–83` (`Subtype: Type1`, `BaseFont: Helvetica…`, kein `FontFile`); Default `font: "helvetica"` | Jedes ZUGFeRD-Dokument **muss** `registerFont()` mit einer TTF aufrufen. Das ist kein Flag, das ist ein anderes Nutzungsregime. |
| PDF/A verbietet **Verschlüsselung** im Trailer. fast-pdf bietet `encrypt` als Dokumentoption an.                           | `[6.1.3-2]`      | `src/pdf/writer.ts:192`, `src/pdf/encrypt.ts`                                                                      | `encrypt` + ZUGFeRD muss hart fehlschlagen.                                                                                     |
| PDF/A verlangt für **DeviceRGB** einen OutputIntent. fast-pdf malt alles in DeviceRGB.                                     | `[6.2.4.3-2]`    | `src/images/image.ts:106`, `src/types/css-color.ts`                                                                | Ohne OutputIntent ist **jede Seite** ein Fehler.                                                                                |
| **CMYK-JPEGs** brauchen einen CMYK-Zielraum — ein Dokument hat aber nur einen OutputIntent.                                | `[6.2.4.3-3]`    | `src/images/jpeg.ts:39`                                                                                            | Im PDF/A-Modus müssen CMYK-JPEGs abgelehnt werden.                                                                              |
| **Importierte Fremdseiten** bringen Fonts, Farbräume und Operatoren mit, über die fast-pdf keine Kontrolle hat.            | `[6.2.2-1]`      | `src/pdf/import.ts`                                                                                                | `append()` muss im PDF/A-Modus gesperrt werden — alles andere wäre ein eigener Validator.                                       |

Der Rechercheur fasst es so zusammen, und das ist der Kern der Sache:

> „PDF/A ist kein Feature, das man neben bestehende Features stellt — es ist
> ein **Modus**, der bestehende Features abschaltet."

Gegenprobe an der echten Ausgabe (`npm run example`, dann `strings` über
`examples/output/invoice.pdf` und `showcase.pdf`): **null** Treffer für
`/Metadata`, `/OutputIntents`, `/EmbeddedFiles`, `/AFRelationship`,
`/MarkInfo`, `/StructTreeRoot` und `/FontFile2`; die Schriften erscheinen als
`/Type1`. Ein fast-pdf-Dokument ist heute nicht „fast PDF/A" — es fehlt jeder
einzelne Baustein.

Dazu kommt, dass der Katalog heute ein einziges Objektliteral mitten in der
privaten Methode `render()` ist (`src/document/document.ts:3193-3208`) — ohne
Erweiterungspunkt für `/Metadata`, `/OutputIntents`, `/AF`, `/Names`. Ein
Subpath-Export kann da von außen nicht hineingreifen. Das ist Designarbeit,
die ein eigenes Minor-Release verdient.

### Der 1.0.0-Scope war zu klein

CI, API-Freeze und externe Validierung sind richtig, aber sie sind nicht das,
was am meisten blockiert. Blockierend ist, dass **die dokumentierten Zusagen
heute nicht stimmen**. Eine 1.0 ist ein Versprechen; ein Versprechen auf Basis
falscher README-Aussagen ist schlechter als ein spätes Release. Alle fünf
Befunde sind im Repo verifiziert, nicht vermutet — siehe §2.

---

## 2. Was 1.0.0 blockiert

Legende Aufwand: **PT** = Personentage, Schätzung des Projektleiters.

### B1 — Die README-/SECURITY-Zusagen widersprechen dem Code (3 Fälle) · 1,5 PT

Drei dokumentierte Aussagen sind **faktisch falsch**, seit PAdES-Signaturen und
AcroForm-Signaturfelder ausgeliefert wurden:

| Aussage                                                                                              | Fundstelle                                            | Realität                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „fast-pdf does not cryptographically sign the document itself"                                       | `README.md:648`                                       | Falsch. Detached **PAdES-B (CAdES)** ist implementiert: `src/pdf/sign.ts` (`signaturePlaceholder`, `embedSignature`), aufgerufen aus `src/document/document.ts:3136,3219,3230` über `signature({ sign })`. 6 Tests in `tests/signing.test.ts`. Im CHANGELOG seit Zeile 378 dokumentiert. |
| „Authenticity requires digital signatures (PAdES) … **currently outside the scope of this library**" | `SECURITY.md`, Abschnitt „Trust boundaries"           | Falsch, derselbe Grund.                                                                                                                                                                                                                                                                  |
| „Generated PDFs are passive: no JavaScript, **no embedded files, no forms**"                         | `README.md` §Security und `SECURITY.md` §Threat model | Teilweise falsch: `/AcroForm` mit `/Widget`-Feldern und `SigFlags` wird geschrieben (`src/document/document.ts:3147,3204`). „no forms" stimmt nicht. „no embedded files" stimmt heute — siehe Konflikt A.                                                                                |

Hinzu kommt: **das PAdES-Feature ist im README überhaupt nicht dokumentiert.**
`SigningOptions` wird aus `src/index.ts:104` exportiert, `grep -i pades README.md`
liefert nichts. Ein kryptografisches Feature undokumentiert in eine 1.0
einzufrieren, ist nicht vertretbar.

**Arbeit:** README §Security und §Signature fields korrigieren, SECURITY.md
§Threat model und §Trust boundaries korrigieren, PAdES-Signatur im README
dokumentieren (eigener Abschnitt mit Beispiel, Grenzen: genau eine Signatur
pro Dokument, kein RFC-3161-Timestamp — beides steht schon in `docs/README.md:216-217`).

### B2 — Die Security-Zusage ist nirgends als Test verankert · 0,5 PT

`tests/security.test.ts` hat 19 Tests, aber **keinen**, der die Kernaussage
prüft (`grep 'EmbeddedFile\|passive\|JavaScript' tests/security.test.ts` →
null Treffer). Die wichtigste Zusage des Pakets ist reiner Fließtext.

**Arbeit:** Ein Invariantentest über ein Standarddokument: kein
`/EmbeddedFiles`, kein `/JavaScript`, kein `/Launch`, kein `/OpenAction` mit
Aktion, kein `/AA`. Das ist die Zusage, die Konflikt A später schützt — ohne
diesen Test ist „ZUGFeRD nur im Subpath" eine Absichtserklärung statt einer
Eigenschaft.

### B3 — Die Bundle-Größe im README ist um den Faktor 4 falsch · 0,5 PT (Korrektur) / offen (Behebung)

Gemessen auf diesem Stand (`npm run build`, dann esbuild `--bundle --minify`,
gzip -9):

| Angabe im README                    | Gemessen                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| „~13 KB min+gzip" (Zeile 5)         | **52 KB** min+gzip (voller Export)                                                                                         |
| „~94 KB ESM, tree-shakeable" (§Why) | **300 KB** ESM (`dist/index.js`)                                                                                           |
| „tree-shakeable"                    | Ein minimales Dokument (`new PDFDocument()` + `text()` + `table()`) kommt auf **48 KB** gzip — Tree-Shaking spart **7 %**. |

Ursache ist strukturell: `src/document/document.ts` ist allein **101 KB** des
Bundles, und weil SVG, Markdown, WebP, Reader und DOM-Tabelle alle an
`PDFDocument` hängen, kann kein Bundler sie entfernen.

Diese Zahl steht im README in der Vergleichstabelle **gegen die Konkurrenz**.
Sie ist das Verkaufsargument des Pakets und sie ist nicht wahr.

**Arbeit (1.0.0):** Zahlen auf die gemessenen Werte korrigieren,
„tree-shakeable" entweder streichen oder ehrlich qualifizieren, und einen
Size-Check in CI aufnehmen, der die Zahl ab sofort festhält (Budget + Fehler
bei Überschreitung). Die _Behebung_ (Aufspaltung von `document.ts`) ist
**nicht** 1.0.0 — siehe §4.

### B4 — Es gibt keine CI · 2 PT

`.github/` existiert nicht. Folgen, die alle heute wahr sind:

- `npm run test:coverage` **schlägt fehl**: Statements 89,09 % (Schwelle 90),
  Branches 79,85 % (Schwelle 80). Exit 1. Eine CI mit dem projekteigenen Gate
  ist am ersten Tag rot. (`npm test` ohne Coverage läuft grün: 25 Dateien,
  451 Tests. `typecheck` und `lint` sind sauber.)
- Die Coverage ist dabei **unbemerkt zurückgegangen**: `docs/README.md:62`
  notiert 92,08 % Lines / 83,8 % Branches, gemessen sind es heute 91,46 % /
  79,85 %. Niemand hat es gemerkt, weil nichts es misst. `prepublishOnly`
  ruft `npm test` auf, nicht `test:coverage` — die Schwelle hat also auch
  kein Release je geprüft.
- Das README verspricht **Node, Bun, Deno, Browser, Edge**. Keine dieser
  Umgebungen wird je getestet. `engines: node >= 18`, getestet wird lokal auf
  Node 26.
- Das Paket liegt veröffentlicht auf npm (`latest: 0.8.1`), ohne Provenance.

**Arbeit:** GitHub-Actions-Workflow mit `format:check`, `lint`, `typecheck`,
`test`, `build`; Matrix Node 18/20/22/24 plus Bun und Deno; Coverage-Gate
(entweder Lücke schließen oder Schwelle bewusst auf den Ist-Stand setzen und
begründen — nicht stillschweigend senken); Size-Budget aus B3;
Release-Workflow mit `npm publish --provenance`.

### B5 — API-Freeze: `src/index.ts` ist so nicht einfrierbar · 2 PT

104 Zeilen, aber zwei Gruppen von Exporten, die eine SemVer-Zusage nicht
tragen sollten:

**(a) Die Low-Level-Engine.** `PDFWriter`, `ContentStream`, `Ref`, `Name`,
`PDFString`, `serialize`, `PDFValue`, `deflate`, `inflate`,
`supportsCompression`, `createSecurityHandler`, `EmbeddedFont`, `TTFFont` —
exportiert mit dem Kommentar „for advanced use and future extensions",
**in README und `examples/` kein einziges Vorkommen** (verifiziert per grep).
Sie bei 1.0.0 einzufrieren heißt, die Interna der Engine dauerhaft
festzuschreiben — und zwar genau die Teile, die PDF/A und ZUGFeRD in 1.1
anfassen werden.

**(b) Die DOM-Schicht.** `tableToPDF`, `tableToRows`, `downloadTablePDF`,
`attachTablePdfButton` sind browserexklusiv, liegen aber im Haupteinstieg und
ziehen ~17 KB Browser-Code in jedes Node-Bundle.

**(c) Ein Typ ohne Feature-Dokumentation.** `SigningOptions` ist exportiert,
das zugehörige Feature im README unerwähnt (siehe B1).

**Arbeit:** Bewusster Schnitt vor dem Freeze —
(a) hinter einen Subpath `fast-pdf/internal` mit ausdrücklichem
„nicht SemVer-stabil"-Hinweis, oder ersatzlos streichen;
(b) nach `fast-pdf/dom`, optional mit deprecated Re-Export im Haupteinstieg;
(c) dokumentieren.
Danach die verbleibende Oberfläche durchgehen und als eingefroren markieren.
**Beides sind Breaking Changes. Sie kosten in 0.9.0 fast nichts und sind nach
1.0.0 unmöglich.** Das ist die Entscheidung mit der größten Bindungswirkung
im ganzen Release — siehe §6, Frage 1.

### B6 — Keine Validierung gegen einen externen Prüfer · 0,5–0,75 PT

Die Tests prüfen selbsterzeugte PDF-Struktur gegen eigene Erwartungen. Wenn
die Erwartung falsch ist, ist der Test grün und das PDF kaputt. Für eine 1.0
muss mindestens ein unabhängiger Prüfer dem Output zustimmen.

Das Werkzeug steht fest (`docs/research/validatoren-ci.md`): **`qpdf --check`**
— Apache-2.0, apt-Paket, **unter 100 ms pro Datei**, keine JVM. Es findet genau
die Fehlerklasse, die die heutigen Tests strukturell nicht finden können:
abweichende `/Length`-Werte, kaputte xref-Offsets, defekte Stream-Encodings.
Optional `pdfcpu validate --mode strict` daneben. Ghostscript und `mutool`
scheiden aus (AGPL bzw. fehlende Prüfsemantik).

Die sechs Beispieldokumente rendern verifiziert in Sekunden (`npm run example`
& Co., alle sechs OK) — das Gate ist damit praktisch geschenkt.

**Abgrenzung:** 1.0.0 verlangt **Struktur**validierung, nicht
PDF/A-Konformität. veraPDF gehört zu 1.1 (siehe §5).

### B7 — Die Limitations-Tabelle trägt in dieser Form keine 1.0 · 0,5 PT

Die Tabelle (`README.md:675 ff.`) ist in der Sache gut — die Grenzen sind
bewusst gezogen. Zwei Probleme:

**Tragbar für eine 1.0, unverändert lassen:** Editieren bestehender PDFs ·
WOFF/WOFF2 · Kerning/Ligaturen/komplexe Schriftsysteme · Gradients/Patterns ·
CFF-OpenType und `.ttc` · lossy WebP / interlaced PNG · HTML-Seiten → PDF ·
Formularfelder außer Signaturen. Jede dieser Grenzen folgt aus „keine
Runtime-Dependencies, kleines Bundle" und ist ehrlich benannt.

**Nicht tragbar wie formuliert:**

1. _„Tagged PDF (`StructTreeRoot`), PDF/A, PDF/UA"_ — drei verschiedene Dinge
   in einer Zeile, die auseinandergezogen gehören. PDF/A bekommt einen
   Zieltermin (1.1). Bei **PDF/UA war meine Annahme falsch**: die Recherche
   (`docs/research/stichtage-rechtslage.md`) findet **keinen einzigen
   Stichtag, der PDF/UA namentlich fordert** — das BFSG gilt zwar seit
   28.06.2025, nennt aber weder EN 301 549 noch PDF/UA; PDF/UA steht dort nur
   in einer _informativen_ Anmerkung, und EN 301 549 V4.1.1 ist unter der
   Barrierefreiheitsrichtlinie **nicht im EU-Amtsblatt zitiert**. Die ehrliche
   Zeile lautet also nicht „kommt bis Datum X", sondern: _kein geltender
   Stichtag fordert PDF/UA; wird neu bewertet, sobald EN 301 549 harmonisiert
   wird._ Eine erfundene Deadline wäre schlechter als gar keine.
2. **Fehlende Zeilen**, die dazugehören: keine XMP-Metadaten (nur `/Info`);
   ein Dokument mit der Standardschrift ist **nicht archivierbar**, weil die
   Schrift nicht eingebettet ist; Tree-Shaking reduziert ein einfaches
   Dokument praktisch nicht (B3).

---

## 3. Die beiden Zusagen-Konflikte — ausdrückliche Auflösung

### Konflikt A — „keine eingebetteten Dateien" vs. ZUGFeRD

**Der Widerspruch.** `README.md` §Security und `SECURITY.md` §Threat model
sagen zu, erzeugte PDFs enthielten keine eingebetteten Dateien. ZUGFeRD
verlangt genau eine eingebettete Datei (das CII-XML) mit `/AFRelationship`
und Eintrag im `/Names`-Baum.

**Auflösung: die Zusage wird präzisiert, nicht zurückgezogen.**

Sie ist heute als Eigenschaft _der Bibliothek_ formuliert. Sie wird zur
Eigenschaft _des Dokuments, das die Bibliothek ohne ausdrückliche Anweisung
erzeugt_:

> fast-pdf bettet niemals eine Datei ein, außer der Aufrufer verlangt es
> ausdrücklich. Ein über `new PDFDocument()` erzeugtes Dokument enthält keine
> eingebetteten Dateien, keine JavaScript-Aktionen, keine Launch-Aktionen und
> keine externen Inhalte. Der einzige Weg zu einer eingebetteten Datei führt
> über den ausdrücklich importierten Subpath `fast-pdf/zugferd`, und er bettet
> genau eine vom Aufrufer gelieferte XML-Nutzlast mit festem MIME-Type und
> festem `/AFRelationship` ein. Aus einem importierten Fremd-PDF kommt
> weiterhin **nie** ein Anhang mit (`append()` verwirft `/FileAttachment`
> unverändert).

Drei Bedingungen, damit das keine Wortklauberei ist:

1. **Die Formulierung landet in 1.0.0**, nicht erst in 1.1 — damit das
   1.0-Versprechen nicht schon vom nächsten Minor-Release widerlegt wird.
2. **Der Invariantentest aus B2 verankert sie.** Ohne Test ist es Prosa.
3. **Die Allowlist im Import bleibt unberührt.** Das Einbetten ist eine
   Erzeugungsfunktion, keine Lockerung der Importprüfung.

Der dritte Teilsatz derselben Zusage — „no forms" — ist unabhängig von
ZUGFeRD heute falsch und wird in B1 korrigiert.

### Konflikt B — Bundle-Zusage vs. PDF/A-Pflichtbeigaben

**Die Annahme war falsch — der Konflikt liegt woanders.** Die Vermutung
lautete: ein ICC-Profil sprengt das Bundle. Die Recherche widerlegt das
(`docs/research/pdfa3b-anforderungen.md`, Abschnitt C):

> `sRGB-v2-micro.icc` — **456 Bytes roh, 349 Bytes gzip**, ICC v2.1, Device
> Class `mntr`, Farbraum `RGB`, Lizenz **CC0 1.0** (Compact ICC Profiles,
> Lizenz über die GitHub-API bestätigt). Erfüllt `[6.2.3-1]` nachweislich.

Unter 0,7 % des _gemessenen_ Bundles. **Das ICC-Profil ist kein Problem und
war nie eines.** Es kann sogar mitgeliefert werden.

**Der echte Konflikt ist die Schrift.** PDF/A-3b verlangt, dass _alle_
Schriften eingebettet sind (`[6.2.11.4.1-1]`). Damit sind die Standard-14
tot — und die sind in fast-pdf der **Default-Pfad**: wer nichts tut, bekommt
Helvetica als nacktes `/Type1`-Dictionary ohne `FontFile`
(`src/fonts/font.ts:76–83`). Daraus folgt die eigentliche Abwägung:

| Weg                                                  | Folge                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **(a) Der Aufrufer muss eine TTF registrieren**      | Kein Byte Zuwachs. Dafür wirft `zugferd(...)` ohne `registerFont()` — unbequem, aber ehrlich.       |
| (b) fast-pdf liefert eine subsettbare Sans-Serif mit | 100–300 KB Rohfont im Paket. Das ist das **Fünf- bis Fünfzehnfache** des gesamten heutigen Bundles. |

**Auflösung — in zwei Stufen.**

_Stufe 1 (1.0.0):_ Die Bundle-Zusage ist heute **ohnehin falsch** (B3: 52 KB
statt 13 KB). Solange sie nicht stimmt, ist sie kein belastbares Argument
gegen irgendetwas. Also: Zahl korrigieren, Size-Budget in CI. Erst damit wird
die Bundle-Zusage wieder zu einer Grenze, auf die man sich berufen kann.

_Stufe 2 (1.1.0):_ Drei Regeln.

1. Das Kernpaket `fast-pdf` wächst durch ZUGFeRD um **null Byte**. Der
   Size-Check aus B3 setzt das durch, nicht die Disziplin des Entwicklers.
2. **Weg (a): die Schrift kommt vom Aufrufer.** `fast-pdf/zugferd` wirft mit
   einem verwertbaren `FastPDFError`, wenn das Dokument eine Standard-14-Schrift
   benutzt. Keine mitgelieferte Schrift — das ist die Grenze, an der die
   Identität des Pakets („dependency-frei, klein") tatsächlich hängt.
3. Das **ICC-Profil wird mitgeliefert**, hinter dem Subpath
   (`fast-pdf/zugferd` bringt es mit, 456 Bytes, CC0, Herkunft und Lizenz im
   Quelltext vermerkt). Ein Aufruf ohne OutputIntent ergäbe kein PDF/A-3b;
   dem Nutzer dafür eine Dateibeschaffung aufzubürden, wäre Schikane bei 456
   Bytes. Optional bleibt ein Parameter, um ein eigenes Profil zu setzen
   (z. B. CMYK-Druckprofil).
   _Nicht verwenden:_ `sRGB_IEC61966-2-1_black_scaled` — abweichende
   Lizenzbedingungen, von der ICC abgelöst.

**Nebenbefund zur Umsetzbarkeit.** Der Subpath funktioniert nur sauber, wenn
`tsup` die gemeinsamen Teile als Chunk teilt, statt den Kern in beide Bundles
zu kopieren. Die heutige `tsup.config.ts` baut zwei getrennte Ein-Entry-Configs;
ein dritter Entry gehört in dieselbe Config, damit ESM-Code-Splitting greift.
Das ändert das `dist/`-Layout (zusätzliche Chunk-Dateien), ist aber keine
API-Änderung und darum nicht freeze-relevant. Kosten: ~0,5 PT, in 1.1.

---

## 4. Scope 1.0.0 — was drin ist, in Reihenfolge

| #   | Paket                                                                                               | Warum blockierend                                                                                                                                                                            | Aufwand |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | **B1** Zusagen korrigieren (README §Security, §Signature fields, SECURITY.md) + PAdES dokumentieren | Eine 1.0 mit falschen Sicherheitsaussagen ist nicht vertretbar                                                                                                                               | 1,5 PT  |
| 2   | **B2** Invariantentest „passives Dokument"                                                          | Macht die Kernzusage prüfbar und schützt Konflikt A                                                                                                                                          | 0,5 PT  |
| 3   | **B3** Bundle-Zahlen korrigieren + Size-Budget                                                      | Headline-Zahl ist um Faktor 4 falsch und steht gegen die Konkurrenz                                                                                                                          | 0,5 PT  |
| 4   | **B4** CI (Lint/Typecheck/Test/Build, Runtime-Matrix, Coverage-Gate, Size-Gate, Provenance)         | Fünf beworbene Laufzeiten, null getestet; Coverage-Gate heute rot                                                                                                                            | 2 PT    |
| 5   | **B5** API-Schnitt + Freeze                                                                         | Nach 1.0.0 unmöglich; bindet alles Folgende                                                                                                                                                  | 2 PT    |
| 6   | **B6** Externe Validierung im CI-Lauf (`qpdf --check` über die sechs Beispiel-PDFs)                 | Selbstgeprüfte Struktur ist kein Beweis                                                                                                                                                      | 0,75 PT |
| 7   | **B7** Limitations-Tabelle schärfen + fehlende Zeilen                                               | Zielgruppe sind regulierte Abnehmer; „nicht unterstützt" ohne Datum ist keine Antwort                                                                                                        | 0,5 PT  |
| 8   | Migration Guide 0.8 → 1.0 (fällt aus dem API-Schnitt an)                                            | Breaking Changes brauchen einen Pfad                                                                                                                                                         | 0,5 PT  |
| 9   | **Billige Vorarbeit, die 1.1 entlastet:** `/F 4` (Print-Flag) an Link-Annotationen                  | Einzeiler in `src/document/document.ts:3445–3450`. Ohne ihn scheitert später **jedes** PDF mit Link an PDF/A `[6.3.2-1/-2]`. Ändert Ausgabebytes — gehört also vor den Freeze, nicht danach. | 0,2 PT  |

**Summe: ~8,5 PT.**

**Reihenfolge — entschieden (§6, E1/E2):** Die Punkte 1–4, 6, 7 und 9 gehen
als **0.9.0** raus, danach der API-Schnitt (5) samt Migrationshinweis (8)
ebenfalls in 0.9.0. Die konkrete Zerlegung in abnehmbare Arbeitspakete steht
in **§6a**. 1.0.0 ist danach Versionsbump plus Freeze-Erklärung — und sonst
nichts.

---

## 5. Was auf 1.1.0 rutscht und was gestrichen ist

### Auf 1.1.0: ZUGFeRD / Factur-X hinter `fast-pdf/zugferd`

Begründung: siehe §1 — nicht wegen der Recherche, sondern weil PDF/A-3b das
Standardverhalten von fast-pdf (nicht eingebettete Standard-14-Fonts,
optionale Verschlüsselung) ausschließt und einen Erweiterungspunkt im Katalog
braucht, den es heute nicht gibt. Der Subpath ist dabei kein Kompromiss,
sondern die richtige Form: er löst Konflikt A (ausdrückliche Opt-in-Grenze)
und Konflikt B (kein Byte im Kernbundle) in einem Zug. Subpath-Exporte sind
additiv und damit SemVer-verträglich — 1.0.0 verbaut sich nichts.

**Aufwand (belegt, `docs/research/`):**

| Block                                                                                                                              | PT (Schätzung) |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------: |
| PDF/A-3b-Container (XMP-Writer, OutputIntent+ICC, Font-Zwang, Modus-Schalter + Verbote, eingebettete Datei)                        |           8–14 |
| davon **„veraPDF grün bekommen"** — der Teil, den man nicht planen kann                                                            |        **3–8** |
| ZUGFeRD-Aufsatz (generische `attach()`-API, Profil-Enum, `/AFRelationship`-Matrix, XMP-Extension-Schema, Testkorpus gegen Mustang) |        3,5–5,5 |
| veraPDF- und Mustang-Jobs in CI                                                                                                    |             ~1 |
| **Summe 1.1.0**                                                                                                                    |   **15–28 PT** |

**Zeitdruck ist vorhanden, aber nicht so, wie man denkt.** Ab **01.01.2027**
— in rund zwei Monaten — müssen deutsche Unternehmer mit über 800 000 €
Vorjahresumsatz B2B-Rechnungen als E-Rechnung ausstellen
(§ 27 Abs. 38 S. 1 Nr. 2 UStG). **Aber:** das BMF-Schreiben vom 15.10.2025
stellt ausdrücklich klar, dass die rechtlich maßgeblichen Angaben allein im
XML liegen und „die zusätzliche Erstellung eines menschenlesbaren Dokuments
**nicht erforderlich**" ist (UStAE 14.4 Abs. 3). Eine reine XRechnung erfüllt
das Gesetz genauso. **ZUGFeRD ist damit eine Markt-, keine Rechtsanforderung
— fast-pdf steht auf niemandes Compliance-Pfad.** Das ist der Grund, warum
1.0.0 ohne ZUGFeRD verantwortbar ist. Es ist zugleich der Grund, 1.1 nicht
beliebig zu dehnen: das Marktfenster ist real.

**Wettbewerbslage** (`docs/research/stand-der-technik-js.md`): seit dem
13.10.2026 gibt es mit **`@reportwright/pdf`** (MIT, 0 Runtime-Deps) genau
eine dependency-freie JS-Lösung, die ein gültiges PDF/A-3b mit Factur-X-XML
_schreibt_ — mit committeten veraPDF-Reports (146 Regeln, 0 Fehler; allerdings
**vom Projekt selbst erzeugt**, nicht unabhängig bestätigt). Sie hat 2
GitHub-Sterne, ~54 Downloads/Woche, 174 869 B Paketumfang (Writer-Entry
~85 KB). Die Nische ist besetzt, aber ersichtlich nicht verteidigt — und
fast-pdf bringt die Reichweite und die Seitenfeatures mit, die dort fehlen.
Bemerkenswert: **kein** npm-Paket liefert ein sRGB-ICC-Profil aus,
und einen etablierten XMP-Writer gibt es nicht — jede Library baut beides
selbst. Beides müsste fast-pdf also ebenfalls selbst mitbringen (ICC: 456 Bytes).

**Scope-Frage für 1.1 — meine Entscheidung, vom Nutzer zu bestätigen:
nur der Container.** Die Recherche stützt das deutlich:

- Die XML-Erzeugung (CII / EN 16931) ist mit **15–30 PT** geschätzt — 810
  Assertions, ~190 semantische Geschäftsregeln, Codelisten, Mapping auf
  CII D16B. „Das ist kein Nebenprojekt zu einem PDF-Writer."
- Steuerfachlogik ändert sich mit jeder EN-16931-Fassung und jeder nationalen
  CIUS. Das gehört nicht in ein Paket, das sonst nur Bytes schreibt.
- Der Markt ist bereits so geschnitten: XML-Erzeuger gibt es auf npm mehrere.
  Was fehlt, ist ein kleiner Generator, der ein **PDF/A-taugliches PDF
  erzeugt**. Alle Anhänge-Pakete (`node-zugferd`, `@stackforge-eu/factur-x`,
  die Python-Referenz `factur-x`) hängen XML an ein _fertiges_ PDF und können
  PDF/A deshalb nur **konservieren, nicht herstellen**. Wer Seiteninhalt und
  Container in einem Prozess hat, löst ein Problem, das die anderen prinzipiell
  nicht lösen können. **Das ist die Lücke, in die fast-pdf passt.**

Die API-Fuge dazu:

```ts
doc.attachFacturX(xml, { profile: "EN 16931" }); // + PDF/A-3b-Modus
```

Was fast-pdf dabei trotzdem leisten muss, damit der Schnitt keine Ausrede ist:
Dateinamen festnageln (`factur-x.xml`, bzw. `xrechnung.xml` — BR-HYBRID-13,
Fatal), `fx:ConformanceLevel` gegen die sechs zulässigen Werte prüfen
(BR-HYBRID-07, Fatal), `/AFRelationship` aus der Profil-×-Land-Matrix ableiten
(Default `Alternative` für Deutschland), und das übergebene XML auf
Wohlgeformtheit und passende Guideline-ID prüfen (~20 Zeilen, kein XML-Parser).

**Profil-Einstieg: EN 16931.** MINIMUM und BASIC WL scheiden aus — das BMF
schließt sie namentlich aus (UStAE 14.1 Abs. 14 S. 4: „ausgenommen die Profile
MINIMUM und BASIC-WL"), und die Spezifikation führt dafür Fatal-Regeln
(BR-HYBRID-DE-01/-02). **Konformitätsstufe 3b**, nicht 3a: 3a verlangt Tagged
PDF, das fast-pdf nicht hat. Stufe **3u wäre fast geschenkt**, weil
`src/fonts/embedded.ts:131` bereits immer `ToUnicode` schreibt.

Weitere Vorarbeiten in 1.1: Erweiterungspunkt im Katalog · dritter
tsup-Entry mit Code-Splitting (~0,5 PT) · `append()` im PDF/A-Modus sperren.

**Aktuelle Fassung:** ZUGFeRD 2.5.2 / Factur-X 1.09.2 vom 04.08.2026. Am
Container hat sich gegenüber 2.5 / 1.09 **nichts** geändert (2.5.2 ist ein
Korrigendum am EXTENDED-Profil, also an der XML-Seite). Der Container ist
also versionsstabil — ein weiteres Argument für den gewählten Schnitt.

### Auf 1.2+ / nicht in 1.0: `document.ts` aufspalten

`src/document/document.ts` ist 3.600 Zeilen und 101 KB des Bundles. Das ist
die eigentliche Ursache dafür, dass Tree-Shaking nichts bringt (B3). Die
Aufspaltung ist richtig, aber sie ist Wochen- und keine Tagesarbeit, sie
berührt jede Zeile der öffentlichen API und sie würde 1.0.0 aus dem Zeitplan
werfen. **In 1.0.0 wird die Zahl korrigiert, nicht die Architektur.**

### Gestrichen bzw. ausdrücklich nicht in 1.0.0

| Punkt                                               | Entscheidung                | Begründung                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 95 %+ Coverage (`docs/README.md:62`)                | gestrichen als 1.0-Ziel     | Ist-Stand 91,5 % Lines / 79,9 % Branches. Eine Zahl ist kein Qualitätsziel. Statt dessen: Gate in CI auf dem Ist-Stand festnageln, Lücken gezielt dort schließen, wo sie weh tun (`pdf/import.ts` 74 %, `pdf/reader.ts` 80 % — das ist der Parser für Fremddateien, also der sicherheitsrelevante Teil). |
| Snapshot-Tests (`docs/README.md:59`)                | gestrichen                  | Die externe Validierung (B6) ist das bessere Werkzeug: sie prüft gegen eine fremde Erwartung statt gegen die eigene.                                                                                                                                                                                     |
| Performance-Tests mit Abbruch (`docs/README.md:60`) | auf 1.2                     | Gehört zur Performance-Phase, blockiert kein Versprechen.                                                                                                                                                                                                                                                |
| Tagged PDF / PDF/UA                                 | nicht in 1.0                | Bleibt dokumentierte Grenze, bekommt aber ein Datum (B7).                                                                                                                                                                                                                                                |
| PDF/A-1, PDF/A-2                                    | gestrichen bis auf Weiteres | PDF/A-3 ist das, was ZUGFeRD braucht. A-1/A-2 ohne konkreten Abnehmer ist Vorratsarbeit. `docs/README.md:171-173` wird entsprechend korrigiert.                                                                                                                                                          |
| AES-128                                             | bleibt gestrichen           | Bereits begründet (`docs/README.md:197`): R4 bräuchte MD5.                                                                                                                                                                                                                                               |

---

## 6. Getroffene Entscheidungen

> Entschieden vom Nutzer am **30.10.2026**. Alle fünf sind verbindlich; was
> hier steht, wird nicht noch einmal aufgemacht.

### E1 — API-Schnitt: ja, und zwar als 0.9.0

Die Low-Level-Engine-Exporte (`PDFWriter`, `ContentStream`, `serialize`,
`createSecurityHandler`, `EmbeddedFont`, `TTFFont` u. a.) gehen nach
`fast-pdf/internal` oder raus; `tableToPDF` & Co. nach `fast-pdf/dom`.

_Begründung:_ Sie stehen in keinem README-Abschnitt und keinem Beispiel.
Sie bei 1.0.0 einzufrieren hieße, die Engine-Interna dauerhaft
festzuschreiben — genau die Teile, die PDF/A in 1.1 anfasst. **Der Breaking
Change liegt damit bewusst _vor_ dem SemVer-Versprechen.**

### E2 — Zwischenrelease 0.9.0: bestätigt

_Begründung:_ 1.0.0 ist dann ein reines Stabilitätsversprechen. Die
Alternative wäre ein 1.0 gewesen, das am Tag seiner Veröffentlichung bricht.

### E3 — Bundle-Zahl: korrigieren, nicht verschieben

Die gemessenen Werte kommen ins README. `document.ts` wird **vor 1.0.0 nicht
aufgespalten**.

_Begründung:_ Die Aufspaltung ist Wochen- statt Tagesarbeit und berührt jede
Zeile der öffentlichen API. 52 KB min+gzip sind gegenüber „10+ Runtime-Deps"
und „ein 300-MB-Browser-Binary" weiterhin ein starkes Argument — eine falsche
Zahl ist keines.

### E4 — ZUGFeRD: nur der Container, keine XML-Erzeugung

_Begründung:_ Die XML-Seite ist mit 15–30 PT das Drei- bis Sechsfache des
Containers (3,5–5,5 PT), zieht Steuerfachlogik in ein Paket, das sonst nur
Bytes schreibt, und der Markt ist bereits so geschnitten. Details in §5.

### E5 — Keine mitgelieferte Schrift in 1.1; ICC-Profil wird mitgeliefert

Wer ZUGFeRD will, registriert eine TTF. Das sRGB-Profil (456 Bytes, CC0)
bringt fast-pdf mit.

_Begründung:_ Die Schrift ist die Grenze, an der die Paket-Identität
tatsächlich hängt (100–300 KB gegen ein Gesamtbundle von heute 300 KB). Das
ICC-Profil ist es nicht (0,15 % davon). Siehe §3, Konflikt B.

---

## 6a. Stufe 0.9.0 — der Breaking Change vor dem Versprechen

**Ziel:** Nach 0.9.0 ist jede dokumentierte Aussage über fast-pdf wahr, jeder
Lauf wird von einer CI geprüft, und die öffentliche Oberfläche ist die, die
1.0.0 einfrieren soll. **1.0.0 ist danach idealerweise ein Versionsbump plus
Freeze-Erklärung.**

| Paket                         | Inhalt                                                                                                                                                                                                                                                                                     | Dateien                                                                                           | Blockiert durch                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **P1 Dokumentationswahrheit** | README `:648` („does not cryptographically sign") und `SECURITY.md:89` („PAdES … outside the scope") korrigieren · PAdES-Signierung im README **erstmals dokumentieren** · `SECURITY.md:18` „no forms" korrigieren · Bundle-Zahlen auf die gemessenen Werte · Coverage-Aussage korrigieren | `README.md`, `SECURITY.md`                                                                        | —                                          |
| **P2 Zusage A + Invariante**  | „keine eingebetteten Dateien" von einer Eigenschaft _der Bibliothek_ zu einer Eigenschaft _des erzeugten Dokuments_ umformulieren (§3, Konflikt A) · Invariantentest                                                                                                                       | `README.md`, `SECURITY.md`, `tests/security.test.ts`                                              | — (läuft mit P1 zusammen, gleiche Dateien) |
| **P3 Coverage**               | Statements ≥ 90 %, Branches ≥ 80 % · `prepublishOnly` auf `test:coverage` umstellen                                                                                                                                                                                                        | `tests/*` (außer `security.test.ts`), `package.json`                                              | —                                          |
| **P4 CI**                     | `.github/workflows/` — Node-Matrix 18/20/22, `typecheck`, `lint`, `format:check`, `test:coverage`, `build` · `qpdf --check` über die sechs Beispiel-PDFs als Gate                                                                                                                          | `.github/`                                                                                        | —                                          |
| **P5 API-Schnitt**            | `fast-pdf/internal`, `fast-pdf/dom`, `exports`-Map, Migrationshinweis im CHANGELOG                                                                                                                                                                                                         | `src/index.ts`, neue Entry-Dateien, `package.json`, `tsup.config.ts`, `CHANGELOG.md`, `README.md` | **nach P1–P4**                             |

P1+P2 laufen zusammen (dieselben Dateien), P3 und P4 unabhängig daneben.
P5 kommt zuletzt, weil es `package.json` und `README.md` erneut anfasst und
eine grüne CI als Netz haben will.

### Stand 31.10.2026

| Paket     | Stand          | Belegt durch                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1+P2** | **abgenommen** | Keine Falschaussage mehr in `README.md`/`SECURITY.md` (per grep geprüft); PAdES erstmals dokumentiert (`README.md:660 ff.`, `SECURITY.md:105 ff.`); Zusage A als Eigenschaft des Dokuments umformuliert; Invariantentest in `tests/security.test.ts:191 ff.`; **453 Tests grün** (vorher 451)                                                                                                                                                                       |
| **P4**    | **abgenommen** | `.github/workflows/ci.yml` + `.github/scripts/runtime-smoke.mjs`. Vom Projektleiter unabhängig nachgeprüft: saubere Datei → `qpdf` Exit 0, verbogener `startxref` → Exit 3 („file is damaged", xref wird still rekonstruiert). Die Entscheidung, **Exit 3 als Fehler** zu werten, ist damit belegt richtig: ohne sie ginge eine reparaturbedürftige Datei als grün durch.                                                                                           |
| **P3**    | **abgenommen** | Coverage 89,11 → **92,65 %** Statements, 79,87 → **84,51 %** Branches, 91,46 → **94,24 %** Lines, 95,68 → **96,80 %** Functions. `src/pdf/import.ts` 74,3 → **100 %** Lines, `src/pdf/reader.ts` 79,8 → **98,3 %**. Suite 453 → **542 Tests**, `npm run test:coverage` Exit 0 (vom Projektleiter nachgeprüft). `prepublishOnly` ruft jetzt `test:coverage` — das war die Lücke, durch die die Coverage überhaupt unbemerkt absacken konnte. `src/` blieb unberührt. |
| **P5**    | **abgenommen** | `src/index.ts` auf den Kern reduziert (nur noch 8 Laufzeit-Exporte), neu `src/dom/index.ts` und `src/internal.ts`. `exports`-Map um `./dom` und `./internal` erweitert, beide mit `browser`-Condition. tsup baut sechs Entries mit geteilten Chunks. Version auf **0.9.0**. Migrationstabelle in `CHANGELOG.md:13–59`. Suite **548 Tests**. Implementierung unberührt: `git diff src/` zeigt nur `src/index.ts`.                                                    |

**Entscheidungen des Projektleiters im Zuge von P3:**

- **Coverage-Schwellen angezogen** (`vitest.config.ts`): statements 92,
  lines 93, functions 95, branches 83 — jeweils ein bis zwei Punkte unter dem
  gemessenen Wert. Bündig wäre schikanös, der alte Abstand von fünf bis zehn
  Punkten hat nachweislich nichts gefangen.
- **`src/adapters/save.browser.ts` bleibt mit 0 % in der Rechnung.** Die Datei
  ist unter Node nicht ausführbar und kostet die Gesamtzahlen dauerhaft
  0,2–0,3 Punkte. Sie aus der Messung auszuschließen würde die Prozentzahl
  ohne einen einzigen neuen Test heben — eine Schwellensenkung in Verkleidung.
  Wer sie wirklich abdecken will, braucht ein zweites Vitest-Projekt mit
  Browser-Umgebung; das ist 1.2-Arbeit, nicht 0.9.0.
- **Flake-Verdacht in `tests/signing.test.ts` untersucht und entkräftet.**
  fast-pdf kodiert nirgends selbst einen großen DER-INTEGER: die Seriennummer
  wird als rohe Bytes aus dem Zertifikat kopiert, die RSA-Signatur ist ein
  OCTET STRING, und `integer()` sieht nur die Versionsfelder 1 und 2. Belegt
  durch 15 neue ASN.1-Tests über alle Längenformgrenzen (`src/pdf/asn1.ts`
  jetzt 100 % Branches) und 130 Wiederholungsläufe ohne Fehlschlag. **Kein
  Hinweis auf betroffene Signaturen.**

### 0.9.0 — Endstand, vom Projektleiter nachgeprüft

Alle fünf Pakete sind abgenommen. Eigene Gegenprobe statt Zusicherung:

- **Alle vier Einstiegspunkte lösen aus dem gebauten `dist/` auf**, über eine
  echte `node_modules`-Auflösung außerhalb des Repos: `fast-pdf` rendert,
  `fast-pdf/dom` und `fast-pdf/internal` exportieren das Erwartete, und der
  Kern exportiert **keinen** der 15 verschobenen Namen mehr.
- **Invariante 3 hält.** Genau eine Datei im ganzen `dist/` erwähnt
  `fs/promises` — der Node-Kern-Chunk, den kein Browser-Artefakt referenziert.
  Die Chunk-Closure von `index.browser`, `dom.browser` und `internal.browser`
  ist sauber. Das war der Punkt mit dem höchsten Regressionsrisiko im ganzen
  Schnitt, weil `fast-pdf/dom` ausschließlich im Browser läuft.
- `typecheck`, `lint`, `test` (548), `test:coverage` (Exit 0), `build`: grün.

**Der Kern ist durch den Schnitt um 6,2 % geschrumpft** (52.152 → 48.907 Bytes
min+gzip). Nebenbefund, der die README-Aussage schärft: Tree-Shaking bringt
_innerhalb_ von `fast-pdf` jetzt praktisch nichts mehr (0,2 %), weil das
Einzige, was es je entfernen konnte — der DOM-Reader — gar nicht mehr im Kern
liegt. Code entfernt nicht der Bundler, sondern der Einstiegspunkt, den man
wählt. Das ist die ehrlichere Aussage und steht so im README.

### Was 1.0.0 noch braucht — es ist **kein** reiner Versionsbump

| Offen                                                                                                                                                                                                                                  | Aufwand |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **B7** Limitations-Tabelle schärfen: „Tagged PDF / PDF/A / PDF/UA" auseinanderziehen, PDF/A mit Zieltermin 1.1, PDF/UA **ohne** erfundene Deadline; fehlende Zeilen ergänzen (keine XMP-Metadaten, Standardschrift nicht archivierbar) | 0,5 PT  |
| **Punkt 9** `/F 4` (Print-Flag) an Link-Annotationen — ändert Ausgabebytes, gehört also vor den Freeze                                                                                                                                 | 0,2 PT  |
| **B3, zweiter Teil** Size-Budget als CI-Gate. Ohne es driftet die gerade korrigierte Zahl wieder — genau wie die Coverage gedriftet ist, solange nichts sie gemessen hat                                                               | 0,3 PT  |
| **Freeze-Erklärung** `src/index.ts` als eingefroren dokumentieren; `tests/entry-points.test.ts` hält die Oberfläche bereits als Liste fest, ein neuer Export ist ab sofort eine sichtbare Entscheidung im Diff                         | 0,2 PT  |
| **Entscheidung des Nutzers** zu `.claude/agents/` (siehe unten)                                                                                                                                                                        | —       |

Summe: **~1,2 PT.** Klein, aber nicht null — und der `/F 4`-Punkt muss vor
den Freeze, weil er die erzeugten Bytes ändert.

**Zwei Befunde aus P4, die über CI hinausgehen:**

1. **Node 18 trägt die Dev-Toolchain nicht** — ESLint 10 und Vitest 5 brauchen
   `util.styleText`. Das **Paket** läuft dort aber nachweislich: `dist/index.js`
   rendert auf Node 18.20.8 ein PDF, das `qpdf --check` sauber durchwinkt.
   Entscheidung: `engines: >= 18` bleibt — es ist ein Versprechen an
   _Konsumenten_, nicht an Beitragende. Die CI bildet beides getrennt ab
   (Toolchain-Matrix 20/22, eigener **blockierender** Node-18-Job gegen das
   gebaute Bundle). Im README dokumentiert.
2. **`format:check` ist der erste CI-Schritt und wäre rot.** Betroffen waren
   neun Dateien; `docs/roadmap-1.0.md` und `docs/research/*.md` hat der
   Projektleiter formatiert. Offen bleiben `.claude/agents/pdf-lead.md` und
   `.claude/agents/pdf-researcher.md` — Werkzeugkonfiguration des Nutzers,
   nicht Paketinhalt. **Entscheidung des Nutzers nötig:** entweder einmal
   `npx prettier --write .claude/agents/`, oder `.claude/agents/` in die
   `.prettierignore` aufnehmen. Ohne das eine oder andere scheitert der erste
   CI-Lauf, sobald diese Dateien committet werden.

**Zur Coverage-Aussage (P1):** Das README sagt „thresholds: >90% lines". Das
ist doppelt irreführend — `vitest.config.ts` setzt **vier** Schwellen
(statements 90, lines 90, functions 90, branches 80), und ausgerechnet _lines_
ist die einzige, die heute hält (91,46 %). Reißend sind statements (89,1 %)
und branches (79,9 %).

**Nicht in 0.9.0:** keine ZUGFeRD-Implementierung, kein `npm publish`, keine
Commits ohne ausdrückliche Freigabe.

**Nebenbefund, der eine Entscheidung des Nutzers braucht:** Die falsche
Bundle-Zahl steht nicht nur im README, sondern auch in
`.claude/agents/pdf-dev.md` als **Invariante 4** („Bundle-Budget. ~13 KB
min+gzip, ~94 KB ESM. Jedes Kilobyte wird begründet."). Solange das dort
steht, misst jeder Entwickler jedes künftige Feature an einer Zahl, die um
den Faktor 4 danebenliegt — und lehnt womöglich Features ab, die in
Wirklichkeit ins Budget passen, oder hält ein Budget für eingehalten, das es
nie gab. Die Datei gehört zur Werkzeugkonfiguration, nicht zum Paket; ich
habe sie deshalb **nicht** angefasst. Empfehlung: Invariante 4 auf die
gemessenen Werte setzen und als _Budget_ formulieren („wächst nicht über X"),
nicht als Zustandsbeschreibung.

---

### Stand 27.11.2026 — 1.0.0 ist fertig zum Taggen

Alle offenen Punkte der Tabelle oben sind erledigt:

| Punkt                  | Stand        | Belegt durch                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B7** Limitations     | erledigt     | `README.md` §Limitations: PDF/A (Ziel 1.1), Tagged PDF und PDF/UA getrennt, PDF/UA ohne erfundene Deadline; Zeilen zu XMP, nicht archivierbarer Standardschrift und Tree-Shaking ergänzt.                                                                                                                      |
| **Punkt 9** `/F 4`     | erledigt     | Commit `d559c15`, im CHANGELOG unter 1.0.0 → Fixed.                                                                                                                                                                                                                                                            |
| **B3** Size-Budget     | erledigt     | `scripts/check-size.mjs`, `npm run size`, eigener Schritt im CI-Job `quality` und in `prepublishOnly`. Budgets ~3 % über dem Messwert (Kern 48.933 B → Budget 50.500 B). Gegenprobe: mit künstlich gesenktem Budget endet das Skript mit Exit 1.                                                               |
| **Freeze-Erklärung**   | erledigt     | `README.md` §Stability. Zusätzlich `tests/api-surface.test.ts`: die vollständige Exportliste von `fast-pdf` (66 Namen) und `fast-pdf/dom` (9) **einschließlich der Typen**, ermittelt über die TypeScript-Compiler-API, plus die 43 öffentlichen Methoden von `PDFDocument`. Der bisherige Test sah nur Werte. |
| **Release-Workflow**   | erledigt     | `.github/workflows/release.yml` (aus B4, bisher offen): Tag `v*.*.*` → Tag/Version/Changelog-Abgleich → volle Gate + `qpdf --check` → `npm publish --provenance`.                                                                                                                                              |
| **`.claude/agents/`**  | erledigt     | Dateien sind formatiert und committet; `format:check` ist grün. Invariante 4 in `pdf-dev.md` nennt die gemessenen ~49 KB.                                                                                                                                                                                      |
| **Dev-Abhängigkeiten** | aktualisiert | `npm audit`: 0 Befunde (vorher 9 moderate, alle in der Lint-Toolchain, keiner im ausgelieferten Paket).                                                                                                                                                                                                        |

**Was der Nutzer selbst tun muss** — nichts davon kann oder soll ein Agent
ohne ausdrückliche Freigabe tun:

1. Auf npmjs.com entweder _Trusted Publishing_ für `release.yml` einrichten
   oder ein Automation-Token als Repository-Secret `NPM_TOKEN` hinterlegen.
2. `git tag v1.0.0 && git push origin v1.0.0` — das löst die Veröffentlichung
   aus. Ein npm-Release lässt sich nicht zurücknehmen.

---

## 7. Belegstatus und Beobachtungsposten

Dieses Dokument stützt sich auf `docs/research/`. Drei Einschränkungen, die
der Rechercheur ausdrücklich benannt hat und die ich hier stehen lasse,
statt sie wegzurunden:

1. **Die ZUGFeRD-/Factur-X-Spezifikation lag nicht vor** (FeRD hat 2.3.3 vom
   Download genommen, FNFE-MPE verlangt eine E-Mail-Adresse). Die
   BR-HYBRID-Regeln stammen aus einer Validator-Doku, gegengeprüft an zwei
   echten ZUGFeRD-PDFs aus dem offiziellen Korpus. **Für diese
   Scope-Entscheidung belastbar — vor der Implementierung in 1.1 ist die Spec
   zu beschaffen.** Kostet eine E-Mail-Adresse.
2. **Der ISO-19005-3-Normtext lag nicht vor** (kostenpflichtig). Klauseln und
   Regeltexte stammen aus dem veraPDF-Profil `PDFA-3B.xml`. Praktisch
   unkritisch: veraPDF ist ohnehin das Werkzeug, das im Zweifel „nein" sagt —
   seine Regel _ist_ das Abnahmekriterium.
3. **Validator-Laufzeiten sind geschätzt, nicht gemessen.** Die Ausführung
   der heruntergeladenen Java-Werkzeuge wurde nicht freigegeben. Für die
   `qpdf`-Entscheidung in B6 ohne Belang.

**Beobachtungsposten — vor dem 1.1-Start zu prüfen:** BT-Drs. 21/8283
(JStG 2026) könnte § 27 Abs. 38 UStG im Ausschussverfahren nach dem
08.10.2026 geändert haben; der Volltext wurde nicht gelesen. Das berührt die
1.0.0-Entscheidung **nicht** (ZUGFeRD ist ohnehin Markt-, keine
Rechtsanforderung), könnte aber die Dringlichkeit von 1.1 verschieben — in
beide Richtungen.

## 8. Änderungsprotokoll dieses Dokuments

| Datum      | Änderung                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-27 | Stand 1.0.0 ergänzt (§6a): alle Restpunkte erledigt, Size-Gate, Typ-Oberflächentest und Release-Workflow hinzugekommen.                                                                                                                                                                                                                                                                    |
| 2026-10-30 | Erstfassung. Scope 1.0.0 festgelegt, Konflikte A und B aufgelöst, ZUGFeRD auf 1.1 hinter `fast-pdf/zugferd`.                                                                                                                                                                                                                                                                               |
| 2026-10-30 | **Fünf Entscheidungen des Nutzers festgeschrieben** (§6, E1–E5): API-Schnitt als 0.9.0, Zwischenrelease bestätigt, Bundle-Zahl korrigieren statt `document.ts` aufspalten, ZUGFeRD nur als Container, keine mitgelieferte Schrift. Neuer §6a mit den fünf Arbeitspaketen für 0.9.0. Korrektur zur Coverage-Aussage ergänzt: es sind vier Schwellen, und _lines_ ist die einzige, die hält. |
| 2026-10-30 | Nach Vorliegen von `docs/research/`: Konflikt B neu gefasst (ICC 456 Bytes statt Bundle-Problem — der echte Konflikt ist die Schrift). Aufwände belegt: 1.0.0 ≈ 8,5 PT, 1.1.0 = 15–28 PT. PDF/UA-Aussage in B7 korrigiert (es gibt **keinen** Stichtag). Validator für B6 festgelegt (`qpdf --check`). Profil-Einstieg EN 16931 / Stufe 3b entschieden. §7 Belegstatus ergänzt.            |
