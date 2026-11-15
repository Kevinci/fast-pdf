# Validatoren in CI — veraPDF, Mustang, KoSIT und die PDF-Strukturprüfer

> Recherchestand: **30.10.2026**. Gilt für fast-pdf 0.8.1 (MIT, npm, keine
> Runtime-Dependencies, **keine CI** — `.github/` existiert nicht).
> Siehe auch [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md),
> [`zugferd-container.md`](./zugferd-container.md).

## Frage

Wie werden veraPDF, Mustang und das KoSIT-Prüftool konkret eingebunden (CLI?
Docker? Java? Maven? Lizenz?), was kosten sie an Laufzeit, und was davon lässt
sich in einer GitHub-Actions-CI für ein npm-Paket ohne Runtime-Dependencies
realistisch betreiben? Auch für **reines PDF ohne ZUGFeRD** relevant.

## Kurzantwort

Für PDF/A gibt es faktisch **nur veraPDF** — aktuell **v1.30.3 (07.10.2026)**,
Java-basiert, dual lizenziert **GPLv3+ / MPLv2+**. Einen JS-nativen oder
WASM-portierten PDF/A-Prüfer gibt es **nicht**; der frühere
`veraPDF-pdfbox-validation`-Zweig wurde am 16.07.2025 archiviert. Eine JVM in
der CI ist also unvermeidlich — aber kostenlos: GitHub-`ubuntu-24.04`-Runner
bringen **JDK 8/11/17 (Default)/21/25 vorinstalliert** mit, `actions/setup-java`
entfällt. Da veraPDF nur als **separater Prozess im Build** läuft und nicht
mitausgeliefert wird, berührt das Copyleft das MIT-npm-Paket nicht _(technische
Einschätzung, keine Rechtsberatung)_. Für ZUGFeRD ist **Mustang 2.26.0
(25.08.2026, Apache-2.0)** das effizienteste Einzelwerkzeug: ein Jar-Aufruf
prüft PDF/A-3 (über ein intern eingebettetes veraPDF 1.30.2), das XMP-Extension-
Schema, das XML-Schema **und** das EN-16931-Schematron. Das **KoSIT-Prüftool**
prüft nur XML und lohnt nur, wenn ausdrücklich XRechnung-CIUS zugesichert werden
soll. **Wichtigster Befund für 1.0.0 unabhängig von ZUGFeRD:** `qpdf --check`
ist ein Apache-2.0-apt-Paket, läuft in unter 100 ms pro Datei und wäre heute
schon ein sinnvolles Gate über die sechs vorhandenen Beispiel-PDFs in
`examples/output/` — dafür braucht es keine ZUGFeRD-Entscheidung.

---

## Werkzeugübersicht

| Werkzeug                   | Version / Datum                                                                                   | Einbindung                                                                                                                                                                             | Java nötig?                                            | Lizenz                                                             | Laufzeit (**Schätzung**)                                                | Quelle                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **veraPDF (CLI)**          | **1.30.3**, Release-Notes 07.10.2026                                                              | Installer-ZIP (32 971 125 B) von `software.verapdf.org` + IzPack-Auto-Install-XML; alternativ Docker `ghcr.io/verapdf/cli` (**nur Dev-Tags**); Maven `org.verapdf:verapdf-apps:1.30.3` | **Ja** — Installer verlangt Java 8, 11, 17 **oder 21** | **GPLv3+ ODER MPLv2+**                                             | Install ~10–25 s; 1. PDF ~2–5 s; Folge-PDFs im Batch deutlich schneller | [Releases](https://github.com/veraPDF/veraPDF-library/releases), [README](https://github.com/veraPDF/veraPDF-apps)         |
| **Mustang-CLI**            | **2.26.0**, 25.08.2026                                                                            | Einzelnes Fat-Jar `https://www.mustangproject.org/deploy/Mustang-CLI-2.26.0.jar` (59 163 641 B); Maven `org.mustangproject:validator:2.26.0:shaded`                                    | **Ja** — JRE 11+                                       | **Apache-2.0**                                                     | ~5–15 s pro Aufruf                                                      | [Releases](https://github.com/ZUGFeRD/mustangproject/releases), [Commandline](https://www.mustangproject.org/commandline/) |
| **KoSIT Validator**        | **v1.6.3**, 20.08.2026                                                                            | `validator-1.6.3-standalone.jar` (10 648 594 B) von Maven Central `org.kosit:validator:1.6.3:standalone`                                                                               | **Ja** — Java 11+                                      | **Apache-2.0**                                                     | ~5–15 s pro Aufruf                                                      | [Releases](https://github.com/itplr-kosit/validator/releases)                                                              |
| **KoSIT XRechnung-Config** | **v2026-08-31**, 02.09.2026, `xrechnung-3.0.2-validator-configuration-2026-08-31.zip` (499 607 B) | ZIP entpacken, `-s scenarios.xml -r $PWD`                                                                                                                                              | (über Validator)                                       | **Apache-2.0**                                                     | im Validator enthalten                                                  | [Releases](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases)                                      |
| **qpdf**                   | **12.4.2**, 27.09.2026 (Ubuntu noble: 11.9.0)                                                     | `apt-get install -y qpdf` (**nicht** vorinstalliert)                                                                                                                                   | Nein                                                   | **Apache-2.0**                                                     | < 100 ms / PDF                                                          | [Repo](https://github.com/qpdf/qpdf), [noble](https://packages.ubuntu.com/noble/qpdf)                                      |
| **pdfcpu**                 | **v0.16.4**, 27.10.2026                                                                           | Go-Binary; **kein npm-, kein apt-Paket gefunden**                                                                                                                                      | Nein                                                   | **Apache-2.0**                                                     | < 200 ms / PDF                                                          | [Repo](https://github.com/pdfcpu/pdfcpu), [validate](https://pdfcpu.io/core/validate)                                      |
| **mutool (MuPDF)**         | noble: 1.23.10                                                                                    | `apt-get install -y mupdf-tools`                                                                                                                                                       | Nein                                                   | **AGPL(v3)** + kommerzielle Artifex-Lizenz                         | < 200 ms / PDF                                                          | [noble](https://packages.ubuntu.com/noble/mupdf-tools), [License](https://mupdf.readthedocs.io/en/latest/license.html)     |
| **Ghostscript**            | noble: 10.02.1                                                                                    | `apt-get install -y ghostscript`                                                                                                                                                       | Nein                                                   | AGPL, „Licensing is handled exclusively by Artifex Software, Inc." | ~0,3–2 s / PDF                                                          | [noble](https://packages.ubuntu.com/noble/ghostscript), [Licensing](https://www.ghostscript.com/licensing/index.html)      |

> **Alle Laufzeitangaben sind Schätzungen.** Sie wurden _nicht_ gemessen —
> siehe „Nicht abschließend belegt", Punkt 1.

---

## 1. veraPDF

### Version und Lizenz

- Letztes Release **v1.30.3**, Release-Notes **07.10.2026**, GitHub-Publish
  09.10.2026. Vorgänger 1.30.2 (03.06.2026), 1.30.1 (21.04.2026).
  <https://github.com/veraPDF/veraPDF-library/releases>
- Maven Central bestätigt 1.30.3 als höchste Version
  (`maven-metadata.xml`, `lastUpdated 20261008131908`):
  <https://repo1.maven.org/maven2/org/verapdf/verapdf-apps/maven-metadata.xml>
- Lizenz wörtlich aus dem README, Abschnitt „Licensing": „The veraPDF PDF/A
  Validation Library is dual-licensed, see: GPLv3+ … MPLv2+". Bestätigt im
  Quellcode-Header jeder Datei, z. B.
  `cli/src/main/java/org/verapdf/cli/CliConstants.java` Z. 6–19: „is free
  software: you can redistribute it and/or modify it under the terms of
  **either**: The GNU General public license GPLv3+ … **The Mozilla Public
  License MPLv2+**."
  <https://github.com/veraPDF/veraPDF-apps>

**Was das für fast-pdf (MIT) bedeutet** — _technische Einschätzung, keine
Rechtsberatung:_ In CI wird veraPDF (i) nicht verändert, (ii) nicht mit fast-pdf
gelinkt (eigener Prozess, eigene JVM), (iii) nicht weiterverteilt (Download im
Job, kein veröffentlichtes Artefakt). Copyleft von GPL und MPL greift an der
_Distribution_; bloßes Ausführen als Build-Werkzeug löst keine Pflichten für das
npm-Paket aus. Zusätzlich steht der **MPL-2.0-Zweig** zur Wahl, dessen Copyleft
ohnehin dateibezogen ist. Risikoerhöhend wäre allein: ein **eigenes
Docker-Image mit veraPDF veröffentlichen**. Ein Hinweis in `CONTRIBUTING.md`,
dass veraPDF nur Build-Werkzeug ist, kostet nichts und beugt Rückfragen vor.

### Deckt es PDF/A-3b ab? Und PDF/UA?

Ja, beides.

- Unterstützte Flavours (`-f`/`--flavour`): **1a, 1b, 2a, 2b, 2u, 3a, 3b, 3u, 4,
  4e, 4f**, dazu **ua1, ua2** und **wt1r, wt1a** (WTPDF); `0` = Auto-Erkennung
  aus den Metadaten (Default). <https://docs.verapdf.org/cli/validation/>
- „The veraPDF validation engine implements the PDF/A and PDF/UA specification
  using formalizations of each 'shall' statement"; für PDF/UA gilt: „only
  machine verifiable checks are performed." <https://docs.verapdf.org/validation/>
- Im Profil-Repo gibt es einen eigenen Zweig `PDF_A/3b/` mit den
  3-spezifischen Regeln — `6.8 Embedded files`, `6.6.4 Version and conformance
level identification`, `6.2.11.6 Character encodings`; der Rest wird aus 2b
  geerbt. <https://github.com/veraPDF/veraPDF-validation-profiles>

> **Für fast-pdf wichtig:** Das Auto-Flavour `0` erkennt am XMP, _welche_
> Konformität die Datei behauptet. Ein PDF ohne `pdfaid`-Metadaten ist für
> veraPDF kein „fehlerhaftes PDF/A", sondern gar kein PDF/A — der Lauf muss
> deshalb mit explizitem `--flavour 3b` erfolgen, sonst ist ein grünes Ergebnis
> bedeutungslos.

### Einbindung

**a) Installer (empfohlen, versionspinnbar).** URL-Schema aus der offiziellen
Dockerfile des veraPDF-apps-Repos:

```
https://software.verapdf.org/${FOLDER}/${MAJOR}/verapdf-greenfield-${MAJOR}.${MINOR}-installer.zip
```

<https://github.com/veraPDF/veraPDF-apps/blob/integration/Dockerfile>

Verifiziert per HTTP-HEAD:
`https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip`
→ HTTP 200, `content-length: 32971125`,
`last-modified: Wed, 07 Oct 2026 13:53:20 GMT`.
Die ungepinnte URL `https://software.verapdf.org/rel/verapdf-installer.zip`
liefert aktuell byte-identisch dieselbe Datei — in CI trotzdem die gepinnte
verwenden.

**b) Unattended Install.** Die offizielle Auto-Install-XML liegt im Repo und
selektiert gezielt nur den CLI-Pack —
<https://github.com/veraPDF/veraPDF-apps/blob/integration/docker-install.xml>:

```xml
<com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
  <pack index="0" name="veraPDF GUI"            selected="false"/>
  <pack index="1" name="veraPDF CLI"            selected="true"/>
  <pack index="2" name="veraPDF Documentation"  selected="false"/>
  <pack index="3" name="veraPDF Sample Plugins" selected="false"/>
</com.izforge.izpack.panels.packs.PacksPanel>
```

Ebenfalls dokumentiert unter <https://docs.verapdf.org/install/>
(„unattended mode", `./vera-install ./auto-install.xml`).

**c) Docker — mit Einschränkung.** Das README nennt
`ghcr.io/verapdf/cli:latest`. Die GHCR-Tag-API
(`https://ghcr.io/v2/verapdf/cli/tags/list`) listet jedoch nur `latest` und
`v1.31.203 … v1.31.212` — also **ausschließlich Dev-Builds der
1.31-Entwicklungslinie, kein Release-Tag 1.30.3**. Für reproduzierbare CI
ungeeignet; stattdessen eigenes Image aus dem offiziellen Dockerfile bauen oder
Weg (a).

**d) Maven.** `org.verapdf:verapdf-apps`, `org.verapdf:validation-model`,
Jakarta-Variante `org.verapdf:validation-model-jakarta` (die Mustang nutzt).

### Java-Anforderung

- **Installer:** „The current installation process requires Java 8, 11, 17 or 21
  to be pre-installed." (README, „Download release version")
- **Build aus Source:** Java 11, 17, 21 oder 25.
- **Java 25 ist für den Installer nicht gelistet** — auf GitHub-Runnern also
  explizit `JAVA_HOME_17_X64` oder `JAVA_HOME_21_X64` setzen, nicht den Default
  nehmen, falls sich der Image-Default irgendwann auf 25 verschiebt.

### Exit-Codes (primärbelegt aus dem Quellcode)

`cli/src/main/java/org/verapdf/cli/CliConstants.java`, `enum ExitCodes` —
<https://github.com/veraPDF/veraPDF-apps/blob/integration/cli/src/main/java/org/verapdf/cli/CliConstants.java>

| Code | Konstante                   | Bedeutung (wörtlich)                                                               |
| ---- | --------------------------- | ---------------------------------------------------------------------------------- |
| 0    | `VALID`                     | All files validated and conform to the selected profile(s).                        |
| 1    | `INVALID`                   | All files validated, but at least one does not conform to the selected profile(s). |
| 2    | `BAD_PARAMS`                | Invalid command line parameters.                                                   |
| 3    | `OOM`                       | Out of Java heap space (memory).                                                   |
| 4    | `NO_FILES`                  | No files to process.                                                               |
| 6    | `IO_EXCEPTION`              | I/O Exception while processing.                                                    |
| 7    | `FAILED_PARSING`            | Failed to parse one or more files.                                                 |
| 8    | `ENCRYPTED_FILES`           | Some PDFs encrypted.                                                               |
| 9    | `VERAPDF_EXCEPTION`         | VeraPDF exception while processing.                                                |
| 10   | `JAXB_EXCEPTION`            | Java XML marshalling exception while processing result.                            |
| 11   | `FAILED_MULTIPROCESS_START` | Failed to start multiprocess                                                       |
| 12   | `INTERRUPTED_EXCEPTION`     | Interrupted exception while processing                                             |

(Code 5 ist nicht vergeben.) **Für CI:** `exit 0` als Gate reicht, aber `1`
(inhaltlich invalide) sollte im Log von `7`/`3`/`9` (Tool-/Infrastrukturfehler)
unterschieden werden. Exit-Code `8` ist für fast-pdf besonders sprechend: ein
verschlüsseltes PDF kommt gar nicht erst zur inhaltlichen Prüfung — passend zu
`[6.1.3-2]` in [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md).

### Report-Formate

`--format` unterstützt `text`, `raw`, `html`, `json`; **Default ist XML**.
(`raw` hieß vor 1.24 `xml`; `mrr` ist deprecated.) Ergebnis-Flag im Report:
Attribut `isCompliant`. Batch: Verzeichnis statt Datei übergeben, `-r` für
Unterordner, ZIPs werden direkt gescannt, `--nonpdfext` für Dateien ohne
`.pdf`-Endung, `-l` listet die Profile. <https://docs.verapdf.org/cli/validation/>

### Fertiges GitHub Action?

**Nein, kein offizielles.** Gefundene Dritt-Projekte:

- `ewb4/my-veraPDF-action` — **0 Stars**, letzter Push 22.04.2025, MPL-2.0.
  <https://github.com/ewb4/my-veraPDF-action>
- `pdfix/action-validate-pdf-verapdf-docker` — **0 Stars**, letzter Push
  26.10.2026, Lizenz `NOASSERTION`.
  <https://github.com/pdfix/action-validate-pdf-verapdf-docker>

**Keines davon einbinden.** Sechs Zeilen Shell im eigenen Workflow sind
wartbarer und tragen kein Supply-Chain-Risiko.

---

## 2. Mustang / mustangproject

- **Version 2.26.0**, veröffentlicht **25.08.2026** (Maven `lastUpdated
20260825114730`). <https://github.com/ZUGFeRD/mustangproject>
- **Eigenständiges Fat-Jar:** `https://www.mustangproject.org/deploy/Mustang-CLI-2.26.0.jar`
  — HEAD verifiziert: HTTP 200, `Content-Length: 59163641`,
  `Last-Modified: Tue, 25 Aug 2026 11:48:52 GMT`.
  <https://www.mustangproject.org/commandline/>
- **Maven:** `org.mustangproject:validator:2.26.0` (Classifier `shaded`).
- **Lizenz: Apache-2.0** — README: „Subject to the Apache-2.0 license".
  **Für ein MIT-Projekt vollständig unproblematisch.**
- Der frühere separate Validator **ZUV ist obsolet** und in Mustang integriert.

### Was es prüft — belegt am Quellcode

`validator/src/main/java/org/mustangproject/validator/PDFValidator.java` —
<https://github.com/ZUGFeRD/mustangproject/blob/master/validator/src/main/java/org/mustangproject/validator/PDFValidator.java>

- Z. 59: `private static final PDFAFlavour[] PDF_A_3_FLAVOURS = {PDFAFlavour.PDFA_3_A, PDFAFlavour.PDFA_3_B, PDFAFlavour.PDFA_3_U};`
  → akzeptiert werden **nur PDF/A-3a/3b/3u**.
- Ab Z. ~98, „Step 1 Validate PDF": `VeraGreenfieldFoundryProvider.initialise()`,
  `ValidatorFactory.defaultConfig()`, `TaskType.VALIDATE`; der veraPDF-MRR-Report
  wird als XML in den Mustang-Report eingebettet.
- Z. 352–354: die von veraPDF **automatisch erkannte** Flavour wird gegen
  `PDF_A_3_FLAVOURS` geprüft.
- Z. ~139, „step 2 validate XMP": das XMP-Extension-Schema (`ConformanceLevel`,
  `DocumentType`, `DocumentFileName`, `Version`) wird per XPath geprüft.
- Z. ~336, „step 4: validate additional data": zusätzliche eingebettete Dateien
  gegen `ad/basic/additional_data_base_schema.xsd`.
- **Abhängigkeiten (POM-belegt):** `org.verapdf:validation-model-jakarta` **1.30.2**
  und `com.helger.schematron:ph-schematron-xslt` **8.0.6**;
  `maven.compiler.release = 11`.
  <https://repo1.maven.org/maven2/org/mustangproject/validator/2.26.0/validator-2.26.0.pom>

**Das ist der entscheidende Punkt für fast-pdf:** Mustang prüft in _einem_
Aufruf genau die Kette, die ein ZUGFeRD-Feature liefern müsste — PDF/A-3 →
XMP-Extension-Schema → XML-Schema → EN-16931-Schematron.

### Aufruf

```bash
java -Xmx1G -Dfile.encoding=UTF-8 -jar Mustang-CLI-2.26.0.jar \
     --no-notices --action validate --source invoice.pdf
```

- `--no-notices` unterdrückt Notices (sonst wird EN16931 zusätzlich auf
  XRechnung-Niveau als Notice geprüft).
- Verzeichnisse: `--action validateExpectValid -d <dir>` bzw.
  `validateExpectInvalid` — nützlich für einen Negativ-Testkorpus.
- **Rückgabecode 0 = valide, ≠ 0 = invalide.**
- `2>/dev/null` anhängen, damit nur der XML-Report auf stdout bleibt.
- **Bekanntes Problem in 2.26.0:** Enthält der Dateiname ein `&`, ist der Report
  nicht wohlgeformt und das Ergebnis geht verloren — Issue
  [#1327](https://github.com/ZUGFeRD/mustangproject/issues/1327). In CI also
  keine `&` in Testdateinamen.

---

## 3. KoSIT-Prüftool

- **Engine:** <https://github.com/itplr-kosit/validator> — Release **v1.6.3**,
  `published_at 2026-08-20T16:28:48Z`, Asset `validator-1.6.3-standalone.jar`
  (10 648 594 B). **Apache-2.0.**
- **Konfiguration:** <https://github.com/itplr-kosit/validator-configuration-xrechnung>
  — Release **v2026-08-31**, `published_at 2026-09-02T14:16:20Z`, Asset
  `xrechnung-3.0.2-validator-configuration-2026-08-31.zip` (499 607 B, HEAD
  verifiziert). **Apache-2.0.**

Aufruf aus `docs/usage.md`:

```bash
curl -L "https://repo1.maven.org/maven2/org/kosit/validator/1.6.3/validator-1.6.3-standalone.jar" \
     --output validator-1.6.3-standalone.jar
curl -L "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip" \
     --output validator-configuration.zip
unzip validator-configuration.zip
java -jar validator-1.6.3-standalone.jar -s scenarios.xml -r "$PWD" -h rechnung.xml
```

Java 11+ gefordert (usage.md, Schritt 3). **Return-Codes** (docs/cli.md,
„Return codes"): `0` = alle Dateien akzeptabel · **positive Ganzzahl = Anzahl
abgelehnter Dateien** · `-1` = CLI-Parsing-Fehler · `-2` = Konfigurationsfehler.

### Validiert es ZUGFeRD/Factur-X-CII?

**Nur das XML, aber ja — inklusive reinem EN16931-CII.** Primärbeleg aus
`scenarios.xml` der XRechnung-Konfiguration, Zeile 672:

```xml
<match>exists(/rsm:CrossIndustryInvoice[
  rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID/text()
  = 'urn:cen.eu:en16931:2017'])</match>
```

→ Szenario „EN16931 (CII)" mit XSD
`resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd` und Schematron
`resources/cii/16b/xsl/EN16931-CII-validation.xsl`. Das ist exakt die
Guideline-ID des ZUGFeRD-/Factur-X-**EN-16931**-Profils.
<https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/scenarios.xml>

**Grenzen:**

1. Prüft **nur XML** — keine PDFs, kein PDF/A, keine Einbettung.
2. ZUGFeRD-Profile unterhalb EN16931 (MINIMUM, BASIC WL, BASIC, EXTENDED) tragen
   andere Guideline-IDs (`urn:factur-x.eu:1p0:…`) und werden von **keinem**
   Szenario gematcht → es greift `<noScenarioReport>` (nicht akzeptiert).
3. Die Konfiguration ist XRechnung-zentriert.

**Konsequenz:** Käme ZUGFeRD-Support, wäre **Mustang allein ausreichend**. KoSIT
lohnt zusätzlich nur, wenn explizit XRechnung-CIUS-Konformität zugesichert
werden soll.

---

## 4. GitHub-Actions-Realität

### Rahmenbedingungen (am Runner-Image belegt)

<https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>

- **Java ist vorinstalliert** (Abschnitt „Java", Z. 115–122): 8.0.504+1, 11.0.32+1,
  **17.0.21+9 (default)**, 21.0.13+9, 25.0.5+8 — mit
  `JAVA_HOME_8_X64` … `JAVA_HOME_25_X64`. → `actions/setup-java` **entfällt**,
  spart 10–30 s pro Job.
- **`unzip` ist vorinstalliert** (`unzip 6.0-28ubuntu4.1`).
- **`qpdf`, `ghostscript`, `mupdf-tools` sind NICHT vorinstalliert** → jeweils
  `apt-get install` (~5–15 s).
- Docker ist verfügbar, aber `ghcr.io/verapdf/cli` ist mangels Release-Tags
  nicht reproduzierbar pinnbar (s. o.).

### JS-nativer PDF/A-Prüfer?

**Nein.** Belege:

- npm-Registry-Suche `text=verapdf` → 31 Treffer, **kein Validator**; der einzige
  nahe Treffer ist `@duallab/verapdf-js-viewer` (ein Viewer).
  <https://registry.npmjs.org/-/v1/search?text=verapdf>
- Keine WASM-Portierung auffindbar; die veraPDF-Organisation betreibt nur einen
  pdf.js-Fork (Viewer).
- `veraPDF-pdfbox-validation` wurde am **16.07.2025 archiviert**.

→ Für PDF/A führt kein Weg an einer JVM in CI vorbei. Was in JS bleibt: eigene
Assertions auf die erzeugte Struktur (XMP vorhanden? `/OutputIntent`? `/ID`?
alle Fonts mit `FontFile2`?) als Millisekunden-Unit-Tests. Das ersetzt veraPDF
**nicht**, fängt aber Regressionen vor dem teuren Job ab — und passt zu dem, was
fast-pdfs Tests heute schon tun.

### Workflow-Skizze

> **Vorschlag, nicht angelegt.** Diese Recherche schreibt nichts nach
> `.github/`.

```yaml
# .github/workflows/pdf-conformance.yml — VORSCHLAG
name: PDF conformance
on: [push, pull_request]

env:
  VERAPDF_MAJOR: "1.30"
  VERAPDF_MINOR: "3"

jobs:
  structure:
    # billiges Gate: Sekunden, bricht bei kaputter PDF-Syntax sofort ab
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci && npm run build
      - run: npm run example && npm run showcase && npm run report && npm run cv
      - run: sudo apt-get update && sudo apt-get install -y qpdf
      - name: qpdf --check
        run: |
          rc=0
          for f in examples/output/*.pdf; do
            qpdf --check --warning-exit-0 "$f" || rc=$?
          done
          exit $rc
      - uses: actions/upload-artifact@v4
        with: { name: pdfs, path: examples/output/*.pdf }

  pdfa:
    needs: structure
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@v4
        with: { name: pdfs, path: out }

      - name: Cache veraPDF installation
        id: vcache
        uses: actions/cache@v4
        with:
          path: ~/verapdf
          key: verapdf-${{ env.VERAPDF_MAJOR }}.${{ env.VERAPDF_MINOR }}

      - name: Install veraPDF (unattended)
        if: steps.vcache.outputs.cache-hit != 'true'
        env:
          JAVA_HOME: ${{ env.JAVA_HOME_17_X64 }} # Installer: 8/11/17/21, NICHT 25
        run: |
          V="${VERAPDF_MAJOR}.${VERAPDF_MINOR}"
          curl -fsSL -o installer.zip \
            "https://software.verapdf.org/releases/${VERAPDF_MAJOR}/verapdf-greenfield-${V}-installer.zip"
          unzip -q installer.zip
          cat > auto-install.xml <<'XML'
          <?xml version="1.0" encoding="UTF-8" standalone="no"?>
          <AutomatedInstallation langpack="eng">
            <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
            <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
              <installpath>INSTALLDIR</installpath>
            </com.izforge.izpack.panels.target.TargetPanel>
            <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
              <pack index="0" name="veraPDF GUI"            selected="false"/>
              <pack index="1" name="veraPDF CLI"            selected="true"/>
              <pack index="2" name="veraPDF Documentation"  selected="false"/>
              <pack index="3" name="veraPDF Sample Plugins" selected="false"/>
            </com.izforge.izpack.panels.packs.PacksPanel>
            <com.izforge.izpack.panels.install.InstallPanel id="install"/>
            <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
          </AutomatedInstallation>
          XML
          sed -i "s#INSTALLDIR#$HOME/verapdf#" auto-install.xml
          "$JAVA_HOME/bin/java" -jar \
            "verapdf-greenfield-${V}/verapdf-izpack-installer-${V}.jar" auto-install.xml

      - name: Validate PDF/A-3b (ein Batch-Aufruf über das Verzeichnis)
        run: |
          set +e
          "$HOME/verapdf/verapdf" --flavour 3b --format json --recurse out > verapdf-report.json
          rc=$?
          set -e
          case "$rc" in
            0) echo "::notice::alle PDFs sind PDF/A-3b-konform" ;;
            1) echo "::error::mindestens ein PDF ist nicht PDF/A-3b-konform" ;;
            *) echo "::error::veraPDF-Werkzeugfehler, exit=$rc (2=Params 3=OOM 4=keine Dateien 7=Parse 8=verschlüsselt)" ;;
          esac
          exit $rc

      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: verapdf-report, path: verapdf-report.json }

  zugferd:
    needs: structure
    if: false # erst aktivieren, wenn ZUGFeRD-Output existiert
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@v4
        with: { name: pdfs, path: out }
      - uses: actions/cache@v4
        with: { path: ~/.mustang, key: mustang-2.26.0 }
      - run: |
          mkdir -p ~/.mustang
          [ -f ~/.mustang/Mustang-CLI.jar ] || curl -fsSL \
            -o ~/.mustang/Mustang-CLI.jar \
            https://www.mustangproject.org/deploy/Mustang-CLI-2.26.0.jar
          java -Xmx1G -Dfile.encoding=UTF-8 -jar ~/.mustang/Mustang-CLI.jar \
               --no-notices --action validate --source out/zugferd.pdf \
               > mustang-report.xml 2>/dev/null
```

### Cache-Strategien

- **veraPDF:** `actions/cache` auf `~/verapdf`, Key = Version. (Größe des
  installierten Verzeichnisses **nicht verifiziert**; Installer-ZIP = 33 MB.)
- **Mustang:** das 59-MB-Fat-Jar unter `~/.mustang`, Key = `mustang-2.26.0`.
- **KoSIT:** Jar (10,6 MB) + entpackte Konfiguration (0,5 MB), Key aus beiden
  Versionen.
- **Größter Einzelhebel:** ein veraPDF-Aufruf über das **Verzeichnis** statt n
  Einzelaufrufe — JVM-Start und Profil-Laden amortisieren sich über alle PDFs.

### Geschätzte Job-Laufzeit (**Schätzung**)

| Job                                 | Cold         | Warm (Cache-Hit) |
| ----------------------------------- | ------------ | ---------------- |
| `structure` (Build + Render + qpdf) | 60–110 s     | 45–80 s          |
| `pdfa` (veraPDF, 6 PDFs, ein Batch) | 35–70 s      | 15–30 s          |
| `zugferd` (Mustang, 1 PDF)          | 30–60 s      | 15–30 s          |
| **Gesamt (parallel)**               | **~2–3 min** | **~1–1,5 min**   |

Basis: verifizierte Artefaktgrößen (33 / 59 / 10,6 MB), ein gemessener Download
der veraPDF-ZIP in 3,8 s, sowie Erfahrungswerte für JVM-Start und
Saxon/Schematron-Kompilierung. **Nicht gemessen.**

---

## 5. Allgemeine PDF-Strukturprüfer — relevant für 1.0.0 auch ohne ZUGFeRD

| Werkzeug              | Was es **tatsächlich** prüft                                                                                                                                                                                                                                                       | Was es **nicht** prüft                                                                                                                                                                                          | Lizenz / Verfügbarkeit                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **`qpdf --check`**    | Wörtlich: „Check the file's structure as well as encryption, linearization, and encoding of stream data…". Exit 0 „indicates syntactic correctness of the PDF file."                                                                                                               | Die Doku selbst: Eine fehlerfreie Datei „may still have errors in stream data content" und „may contain constructs that don't conform to the PDF specification". **Kein PDF/A, keine Content-Stream-Semantik.** | Apache-2.0; `apt-get install qpdf`                    |
| **`pdfcpu validate`** | Objekt-/Struktur-Validierung gegen die in pdfcpu implementierten Regeln für PDF 1.7, plus basale PDF-2.0-Checks. `-m/--mode`: **`relaxed`** (Default) toleriert verbreitete Writer-Abweichungen, **`strict`** lehnt erkannte Spec-Verstöße ab. Meldet JavaScript-/Media-Vorkommen. | Doku ausdrücklich: „not a certification of full ISO 32000 compliance". **Kein PDF/A.** Exit-Codes nicht dokumentiert.                                                                                           | Apache-2.0; Go-Binary. **Kein npm-, kein apt-Paket.** |
| **`mutool clean -s`** | `-s` = „Sanitize graphics commands in content streams". `clean` kann defekte Dateien reparieren.                                                                                                                                                                                   | **Kein Validator** — es _repariert_, statt zu melden. Kein PDF/A.                                                                                                                                               | **AGPL(v3)** + kommerzielle Artifex-Lizenz            |
| **Ghostscript**       | Kein Validierungsmodus; taugt nur als „rendert es überhaupt"-Rauchtest (`gs -dBATCH -dNODISPLAY -dNOPAUSE`).                                                                                                                                                                       | Keine Konformitätsaussage. Langsam (rendert).                                                                                                                                                                   | AGPL + Artifex                                        |

**Für fast-pdf:** `qpdf --check --warning-exit-0` über alle sechs
Beispiel-PDFs in `examples/output/` ist das Gate mit dem besten
Nutzen-Aufwand-Verhältnis — Apache-2.0, apt-Paket, unter 100 ms pro Datei, und
es deckt genau die Klasse von Fehlern ab, die die heutigen Tests strukturell
nicht finden können (`/Length`-Abweichungen, kaputte xref-Offsets, defekte
Stream-Encodings). Optional `pdfcpu validate --mode strict` daneben.
**`mutool` und Ghostscript wegen AGPL und fehlender Prüf-Semantik nicht als
CI-Gate.**

---

## Aufwandsschätzung in Personentagen

> **Ausdrücklich eine Schätzung.** Grundlage: eine Person, die das Repo kennt;
> `.github/` existiert noch gar nicht. Nicht enthalten: die eigentlichen
> Code-Änderungen an fast-pdf, um PDF/A-3b-Konformität **herzustellen** — die
> stehen in [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) und hängen
> von den Erstbefunden ab.

| Arbeitspaket                                                                                            |  PT (Schätzung) |
| ------------------------------------------------------------------------------------------------------- | --------------: |
| Basis-CI anlegen (`ci.yml`: install, lint, typecheck, test, build; Matrix Node/Bun/Deno)                |             0,5 |
| Beispiel-PDFs reproduzierbar rendern + als Artefakt hochladen                                           |            0,25 |
| **`qpdf --check`-Gate** über alle Beispiel-PDFs                                                         |            0,25 |
| `pdfcpu validate --mode strict` ergänzen                                                                |            0,25 |
| **veraPDF-Job** (Download pinnen, Auto-Install-XML, Cache, Exit-Code-Mapping, JSON-Report als Artefakt) |       0,75–1,25 |
| Erste PDF/A-3b-Befunde analysieren (nicht beheben)                                                      |             0,5 |
| **Mustang-Job** für ZUGFeRD (nur wenn das Feature existiert)                                            |        0,5–0,75 |
| KoSIT-Job für XRechnung-CIUS (optional)                                                                 |             0,5 |
| Doku (README-Badge, CONTRIBUTING „Validatoren", veraPDF-Lizenzhinweis)                                  |            0,25 |
| **Summe reines PDF, ohne ZUGFeRD**                                                                      |  **≈ 1,75–2,5** |
| **Summe inkl. ZUGFeRD-Validierung**                                                                     | **≈ 2,75–3,75** |

---

## Nicht abschließend belegt

1. **Alle Laufzeitangaben für die Java-Validatoren sind Schätzungen, keine
   Messungen.** Die Artefakte lagen im Scratchpad, die Ausführung des
   heruntergeladenen Codes wurde jedoch von der Sandbox verweigert. Verifiziert
   sind nur die Artefaktgrößen (veraPDF-Installer 32 971 125 B, Mustang-CLI
   59 163 641 B, KoSIT-Jar 10 648 594 B, KoSIT-Config-ZIP 499 607 B) und ein
   Download der veraPDF-ZIP in 3,8 s.
2. **Größe des installierten veraPDF-Verzeichnisses** (für die
   Cache-Dimensionierung) — nicht ermittelt.
3. **Ob der IzPack-Installer mit Java 25 funktioniert** — das README listet nur
   8/11/17/21; nicht getestet. Im Workflow-Vorschlag deshalb bewusst
   `JAVA_HOME_17_X64`.
4. **veraPDF-Exit-Code in Randfällen:** Issue
   [#1223](https://github.com/veraPDF/veraPDF-library/issues/1223) berichtet
   einen inkonsistenten OOM-Exit-Code (1 statt 3). Ob in 1.30.3 behoben: nicht
   geprüft. Deshalb zusätzlich den JSON-Report auswerten, nicht nur den Code.
5. **Exit-Codes von `pdfcpu validate`** sind nicht dokumentiert.
6. **Genaue AGPL-Version von Ghostscript** — ghostscript.com/licensing nennt
   keine Versionsnummer.
7. **GitHub Marketplace** konnte nicht direkt durchsucht werden (nur
   Repo-Suche). Die Aussage „kein offizielles veraPDF-Action" stützt sich
   darauf, dass die veraPDF-Organisation kein solches Repo führt.
8. **Die Lizenz-Einschätzung zu veraPDF ist eine technische Einschätzung, keine
   Rechtsberatung.** Belegt sind allein die Lizenztexte und der
   Dual-Lizenz-Charakter.

## Quellen

**veraPDF**

- <https://github.com/veraPDF/veraPDF-library/releases> · <https://github.com/veraPDF/veraPDF-library/releases/tag/v1.30.3>
- <https://github.com/veraPDF/veraPDF-apps> (README: Lizenz, Java, Installer, Docker)
- <https://github.com/veraPDF/veraPDF-apps/blob/integration/Dockerfile>
- <https://github.com/veraPDF/veraPDF-apps/blob/integration/docker-install.xml>
- <https://github.com/veraPDF/veraPDF-apps/blob/integration/cli/src/main/java/org/verapdf/cli/CliConstants.java> (Exit-Codes)
- <https://github.com/veraPDF/veraPDF-validation-profiles> (Profilbaum `PDF_A/3b/`)
- <https://docs.verapdf.org/cli/validation/> · <https://docs.verapdf.org/validation/> · <https://docs.verapdf.org/install/>
- <https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.3-installer.zip> (HTTP-HEAD verifiziert)
- <https://repo1.maven.org/maven2/org/verapdf/verapdf-apps/maven-metadata.xml>
- <https://ghcr.io/v2/verapdf/cli/tags/list> (nur Dev-Tags)
- <https://github.com/veraPDF/veraPDF-library/issues/1223>

**Mustang**

- <https://github.com/ZUGFeRD/mustangproject> · <https://github.com/ZUGFeRD/mustangproject/releases>
- <https://github.com/ZUGFeRD/mustangproject/blob/master/validator/src/main/java/org/mustangproject/validator/PDFValidator.java>
- <https://github.com/ZUGFeRD/mustangproject/issues/1327>
- <https://www.mustangproject.org/commandline/>
- <https://repo1.maven.org/maven2/org/mustangproject/validator/2.26.0/validator-2.26.0.pom>

**KoSIT**

- <https://github.com/itplr-kosit/validator/releases> · <https://github.com/itplr-kosit/validator/blob/main/docs/cli.md>
- <https://github.com/itplr-kosit/validator-configuration-xrechnung/releases>
- <https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/docs/usage.md>
- <https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/scenarios.xml>

**CI-Umfeld und PDF-Werkzeuge**

- <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>
- <https://qpdf.readthedocs.io/en/stable/cli.html> · <https://github.com/qpdf/qpdf> · <https://packages.ubuntu.com/noble/qpdf>
- <https://github.com/pdfcpu/pdfcpu> · <https://pdfcpu.io/core/validate>
- <https://mupdf.readthedocs.io/en/latest/license.html> · <https://packages.ubuntu.com/noble/mupdf-tools>
- <https://packages.ubuntu.com/noble/ghostscript> · <https://www.ghostscript.com/licensing/index.html>
- <https://registry.npmjs.org/-/v1/search?text=verapdf>
