# ZUGFeRD / Factur-X — was der PDF-Container zusätzlich leisten muss

> Recherchestand: **30.10.2026**. Beantwortet die Fragen 2 (Container), 3
> (Profile) und 4 (Abgrenzung PDF vs. XML).
> Voraussetzung: [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) —
> **alles dort Beschriebene gilt hier zusätzlich.**

## Kurzantwort

Auf dem fertigen PDF/A-3b ist der ZUGFeRD-Aufsatz **klein**: eine eingebettete
Datei namens `factur-x.xml` (MIME `text/xml`), erreichbar über
`/Names → /EmbeddedFiles`, als Associated File am **Katalog** (`/AF`) registriert,
mit `/AFRelationship` passend zu Profil und Land, plus vier XMP-Properties im
Namespace `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#` samt
PDF/A-Extension-Schema-Deklaration. **Page-level `/AF` ist nicht erforderlich** —
in beiden untersuchten echten ZUGFeRD-Dateien steht `/AF` ausschließlich am
Katalog. Aktuell gilt **ZUGFeRD 2.5.2 / Factur-X 1.09.2**, veröffentlicht am
**04.08.2026**; am Container hat sich gegenüber 2.5 / 1.09 **nichts** geändert —
2.5.2 ist ein Korrigendum am EXTENDED-Profil, also an der XML-Seite. Die
eigentliche Arbeit liegt woanders: **das CII-XML ist die 10- bis 20-fache
Aufgabe des Containers**, und der sinnvolle Schnitt heißt deshalb: fast-pdf
liefert den Container und nimmt das XML als `Uint8Array` entgegen.

---

## Quellenlage — bitte lesen, bevor Sie zitieren

Die ZUGFeRD-/Factur-X-Spezifikation ist **nicht frei abrufbar**:

| Quelle                           | Status am 30.10.2026                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| FeRD, ZUGFeRD 2.3.3 (07.05.2025) | „ZUGFeRD 2.3.3 ist nicht mehr zum Download verfügbar" — <https://www.ferd-net.de/en/downloads/publications/details/zugferd-233-english> |
| FeRD, ZUGFeRD 2.5.2 (04.08.2026) | aktuell; Download über ferd-net.de                                                                                                      |
| FNFE-MPE, Factur-X 1.09.2        | Download erfordert E-Mail-Adresse: „Merci de renseigner votre email pour le téléchargement." — <https://fnfe-mpe.org/factur-x/>         |

**Der Spezifikationstext lag dieser Recherche nicht vor.** Die Aussagen unten
stützen sich deshalb auf drei unabhängige Stränge, die sich gegenseitig
bestätigen:

1. **Empirisch** — zwei echte, von ihren Herausgebern als konform
   veröffentlichte ZUGFeRD-2-PDFs aus dem offiziellen Testkorpus
   `ZUGFeRD/corpus` (Apache-2.0, 63 ★, letzter Push 13.10.2026),
   Verzeichnis `ZUGFeRDv2/correct/`. Ich habe beide byteweise seziert.
2. **Normativ für PDF/A** — das veraPDF-Profil `PDFA-3B.xml` (siehe
   [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md)).
3. **Sekundär, aber strukturiert** — die Validator-Dokumentation
   `phax/kaltblut`, Datei `docs/2.5.2.md`, die die BR-HYBRID-Regeln von
   Factur-X 1.09.2 mit Abschnittsbezug auflistet.
   <https://github.com/phax/kaltblut/blob/main/docs/2.5.2.md>

Jede Zeile unten trägt, aus welchem Strang sie stammt. **Wo nur Strang 3
vorliegt, ist das ausdrücklich als „nicht abschließend belegt" markiert.**

---

## Empirische Gegenprobe: zwei echte ZUGFeRD-PDFs

### A) Mustangproject, Profil EN 16931, Deutschland

`ZUGFeRDv2/correct/Mustangproject/MustangGnuaccountingBeispielRE-20201121_508.pdf`,
100 033 Bytes, Header `%PDF-1.4`.

```
1 0 obj  << /Type /Catalog  /Pages 2 0 R  /OpenAction [3 0 R /XYZ null null 0]
            /StructTreeRoot 4 0 R  /Lang (de-DE)  /MarkInfo << /Marked true >>
            /OutputIntents [5 0 R]  /Metadata 6 0 R  /Names 7 0 R  /AF [8 0 R] >>

5 0 obj  << /Type /OutputIntent  /S /GTS_PDFA1
            /OutputConditionIdentifier (sRGB IEC61966-2.1)
            /DestOutputProfile 15 0 R >>
15 0 obj << /Length 8486  /N 3  /Filter /FlateDecode >>  stream …     % ICC

7 0 obj  << /EmbeddedFiles 16 0 R >>
16 0 obj << /Names [(factur-x.xml) 8 0 R] >>

8 0 obj  << /Type /Filespec  /F (factur-x.xml)  /AFRelationship /Alternative
            /UF (factur-x.xml)
            /Desc (Invoice metadata conforming to ZUGFeRD standard \(http://…\))
            /EF 17 0 R >>

107 0 obj << /Length 9439  /Type /EmbeddedFile  /Subtype /text#2Fxml
             /Params 239 0 R >>
```

Seitenobjekt `3 0 obj`: `<< /Type /Page /Parent /Resources /MediaBox
/StructParents /Contents >>` — **kein `/AF`**.

### B) FNFE-MPE, Profil MINIMUM, Frankreich

`ZUGFeRDv2/correct/FNFE-factur-x-examples/Facture_FR_MINIMUM.pdf`,
89 246 Bytes, Header `%PDF-1.6`.

```
10 0 obj << /AF 9 0 R  /Type /Catalog
            /Names << /EmbeddedFiles << /Names [ (factur-x.xml) 5 0 R ] >> >> … >>

5 0 obj  << /Type /Filespec  /AFRelationship /Data
            /F (factur-x.xml)  /UF (factur-x.xml)  /Desc (Factur-X Invoice)
            /EF << /F 4 0 R  /UF 4 0 R >> >>

4 0 obj  << /Length 2818  /Type /EmbeddedFile
            /Params << /Size 2818
                       /ModDate (D:20180610203211+00'00')
                       /CheckSum (9a4b21b34c4c6b02ee976db40435dc88) >> >>

6 0 obj  << /Length 8486  /N 3  /Filter /FlateDecode >>   % ICC, byte-identisch zu A
```

Seitenobjekt `3 0 obj`: wieder **kein `/AF`**.

**Was diese Gegenprobe beweist:**

- `/AFRelationship` ist **`/Alternative`** beim deutschen EN-16931-Profil und
  **`/Data`** beim französischen MINIMUM-Profil — genau wie die
  Profil-×-Land-Matrix es vorgibt (s. u.). Die Regel ist also real und wird
  gelebt.
- `/AF` steht **nur am Katalog**, nicht an den Seiten.
- Der MIME-Typ wird als PDF-Name geschrieben und muss deshalb escapt werden:
  `/text#2Fxml` (der Schrägstrich ist `#2F`). fast-pdfs `serializeName()`
  (`src/pdf/objects.ts:76–90`) macht das bereits korrekt — `/` steht in
  `NAME_IRREGULAR`.
- Beide Dateien deklarieren `%PDF-1.4` bzw. `%PDF-1.6`, nicht 1.7.
- Beide ICC-Streams sind **byte-identisch** (`/Length 8486`, `/N 3`) — dieselbe
  sRGB-Datei, zweimal unabhängig gebündelt. Vergleiche dazu die 456-Byte-Variante
  in [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md).

---

## Frage 2: Die Container-Anforderungen

Legende Pflicht: **MUSS** = Validator-Fatal · **SOLL** = Warning / Empfehlung ·
**optional**.

| #   | Anforderung                                                                                                                                             | Pflicht                | Quelle                                                                                                                        | Stand in fast-pdf                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z1  | Der PDF-Umschlag **MUSS PDF/A-3** sein (ISO 19005-3). PDF/A-4f ist optional ebenfalls zulässig.                                                         | MUSS                   | BR-HYBRID-02 (Fatal), §1 — kaltblut `docs/2.5.2.md`                                                                           | Fehlt vollständig, siehe [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md). veraPDF/Mustang akzeptieren **nur 3a/3b/3u** — belegt in `PDFValidator.java:59`, siehe [`validatoren-ci.md`](./validatoren-ci.md). |
| Z2  | Konformitätsstufe **a / b / u ist für die ZUGFeRD-Konformität gleichgültig**; 3a wird für Barrierefreiheit empfohlen.                                   | optional               | §1, §6.1 — kaltblut                                                                                                           | **3b ist der realistische Einstieg.** fast-pdf schreibt bereits `ToUnicode` (`src/fonts/embedded.ts:131`), damit wäre **3u** fast geschenkt. 3a verlangt Tagged PDF — das hat fast-pdf nicht.                       |
| Z3  | Dateiname des Anhangs: **`factur-x.xml`**. Für das Profil XRECHNUNG: `xrechnung.xml`.                                                                   | MUSS                   | BR-HYBRID-13 (Fatal), §2, §6.2 — kaltblut; **empirisch bestätigt** in beiden Beispieldateien                                  | —                                                                                                                                                                                                                   |
| Z4  | MIME-Typ **`text/xml`**, als `/Subtype` am `EmbeddedFile`-Stream                                                                                        | MUSS                   | §2, §6.2 — kaltblut; `[6.8-1]` ISO 19005-3; **empirisch**: `/Subtype /text#2Fxml`                                             | —                                                                                                                                                                                                                   |
| Z5  | Einbettung über ein **File-Specification-Dictionary** (`/Type /Filespec`) mit `/EF`                                                                     | MUSS                   | `[6.8-2]`, `[6.8-5]`; **empirisch**                                                                                           | —                                                                                                                                                                                                                   |
| Z6  | Das Filespec-Dictionary **MUSS `/F` und `/UF`** enthalten                                                                                               | MUSS                   | `[6.8-2]` ISO 19005-3; **empirisch** (beide Dateien)                                                                          | —                                                                                                                                                                                                                   |
| Z7  | Das Filespec-Dictionary **MUSS `/AFRelationship`** (Name) enthalten                                                                                     | MUSS                   | `[6.8-3]` ISO 19005-3                                                                                                         | —                                                                                                                                                                                                                   |
| Z8  | Wert von `/AFRelationship` nach **Profil-×-Land-Matrix** (Tabelle unten)                                                                                | **SOLL** (Warning)     | BR-HYBRID-11 (**Warning**), §2 — kaltblut; **empirisch bestätigt**                                                            | —                                                                                                                                                                                                                   |
| Z9  | `/Params` am `EmbeddedFile`-Stream mit mindestens `/ModDate`                                                                                            | SOLL                   | §2, §6.2 — kaltblut; **empirisch**: Beispiel B hat `/Size`, `/ModDate`, `/CheckSum`                                           | Konflikt mit `deterministic` (`src/document/document.ts:3522`): ein Zeitstempel bricht byte-stabile Ausgabe. Lösung wie beim Info-Dict: `/ModDate` nur, wenn ein Datum übergeben wird.                              |
| Z10 | Erreichbarkeit über **`/Names → /EmbeddedFiles`** im Katalog; ein oder zwei `/Kids`-Ebenen zulässig                                                     | MUSS                   | §2, §6.2 — kaltblut; **empirisch** (beide, allerdings flach ohne `/Kids`)                                                     | Katalog (`src/document/document.ts:3193`) hat **kein** `/Names`.                                                                                                                                                    |
| Z11 | Registrierung als **Associated File am Dokumentkatalog**: `/AF [<filespec>]`                                                                            | MUSS                   | §2 — kaltblut; **empirisch** (beide)                                                                                          | fehlt                                                                                                                                                                                                               |
| Z12 | **`/AF` auf Seitenebene**                                                                                                                               | **nicht erforderlich** | **empirisch**: in keiner der beiden Dateien vorhanden. Die kaltblut-Doku nennt ausdrücklich nur „document level".             | n/a — Aufwand entfällt.                                                                                                                                                                                             |
| Z13 | `/Desc` am Filespec                                                                                                                                     | **optional**           | „Not covered in the source" (kaltblut, §2); **empirisch** in beiden Dateien vorhanden, aber mit völlig unterschiedlichem Text | Kostet nichts, sollte gesetzt werden.                                                                                                                                                                               |
| Z14 | Die Einbettungsmethode MUSS der Spezifikation entsprechen, insbesondere muss das XML **extrahierbar** sein                                              | MUSS                   | BR-HYBRID-12 (Fatal) — kaltblut                                                                                               | Praktisch heißt das: keine Objektstreams um das Filespec, kein ObjStm-Versteck, `/Length` korrekt. fast-pdf schreibt ohnehin klassisch.                                                                             |
| Z15 | Zusätzliche Anhänge sind erlaubt: PDF, TXT, GIF, TIFF, JPG, CSV, XML, JSON, XLS, XLSX, ODS. Reservierte Namen: `factur-xedifact.edi`, `factur-xubl.xml` | optional               | §4, §6.4 — kaltblut                                                                                                           | Eine allgemeine `attach()`-API deckt beides ab.                                                                                                                                                                     |

### Die `/AFRelationship`-Matrix (BR-HYBRID-11, Warning)

| Profil    | Frankreich                      | Deutschland   |
| --------- | ------------------------------- | ------------- |
| MINIMUM   | `Data`                          | `Data`        |
| BASIC WL  | `Data`                          | `Data`        |
| BASIC     | `Alternative`, `Source`, `Data` | `Alternative` |
| EN 16931  | `Alternative`, `Source`, `Data` | `Alternative` |
| EXTENDED  | `Alternative`, `Source`, `Data` | `Alternative` |
| XRECHNUNG | n/a                             | `Alternative` |

Quelle: kaltblut `docs/2.5.2.md`, Abschnitt „/AFRelationship matrix (BR-HYBRID-11, Warning, §2)".
**Empirisch bestätigt** durch Beispiel A (DE, EN 16931 → `Alternative`) und
Beispiel B (FR, MINIMUM → `Data`).

> **Praktische Lesart für eine Library:** Da die Regel nur **Warning** ist und
> für Deutschland in allen relevanten Profilen `Alternative` lautet, ist
> `/AFRelationship /Alternative` der vernünftige Default, mit Überschreibmöglichkeit.
> Für MINIMUM/BASIC WL wäre `Data` korrekt — diese beiden Profile sind in
> Deutschland aber ohnehin keine E-Rechnung (siehe Frage 3).

### Das XMP-Extension-Schema

**Namespace:** `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`
— **das abschließende `#` ist Teil der URI.**
**Prefix:** `fx`
**Schema-Name:** `Factur-X PDFA Extension Schema`

| Property              | Typ  | Kategorie | Zulässige Werte                                                     |
| --------------------- | ---- | --------- | ------------------------------------------------------------------- |
| `fx:DocumentType`     | Text | external  | `INVOICE`                                                           |
| `fx:DocumentFileName` | Text | external  | `factur-x.xml` (bzw. `xrechnung.xml`)                               |
| `fx:Version`          | Text | external  | `1.0`                                                               |
| `fx:ConformanceLevel` | Text | external  | `MINIMUM`, `BASIC WL`, `BASIC`, `EN 16931`, `EXTENDED`, `XRECHNUNG` |

Regeln (alle **Fatal** außer BR-HYBRID-10/-14/-15):
BR-HYBRID-03 (Extension-Schema MUSS vorhanden sein), -04 (URI), -05 (Prefix `fx`),
-06 (`DocumentType` aus _HybridDocumentType_), -07 (`ConformanceLevel` aus
_HybridConformanceType_), -08 (`DocumentFileName` aus _HybridDocumentFilename_),
-09 (`Version` aus _HybridDocumentVersion_), -10 (`Version` **SOLL** `1.0` sein),
-14 (eingebetteter Dateiname **SOLL** `fx:DocumentFileName` entsprechen),
-15 (`fx:ConformanceLevel` **SOLL** dem Profil des XML entsprechen).
Quelle: kaltblut `docs/2.5.2.md`, Abschnitt „BR-HYBRID rules".

**`fx:Version` bleibt `1.0`, unabhängig von der Spec-Version.** Auch bei
Factur-X 1.09.2 ist der Wert `1.0`; ebenso bleibt die Namespace-URI bei `1p0`.
Die Spec-Version taucht nur in BT-24 (im XML) und in den Validierungsartefakten
auf.

#### Bekannte Inkonsistenz in der Spezifikation

Der Regeltext **BR-HYBRID-04** nennt die URI **ohne** `:invoice`
(`urn:factur-x:pdfa:CrossIndustryDocument:1p0#`), während das durchgerechnete
Beispiel in §6.3.1 die lange Form **mit** `:invoice` verwendet. Laut kaltblut
besteht dieser Widerspruch seit Version 2.3.2 fort.

**Die lange Form ist die richtige.** Belege:

- Empirisch: Die Mustangproject-Datei verwendet
  `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`.
- Die PDFlib-XMP-Vorlage (im Repo `atgp/factur-x`, Datei
  `xmp/Factur-X_extension_schema.xmp`, Kopfkommentar) hält das ausdrücklich fest:

  > „The use of mixed upper/lowercase in `CrossIndustryDocument` conforms to the
  > Factur-X 1.0 specification. The PDF samples distributed with the Factur-X 1.0
  > info package use all-lowercase spelling `crossindustrydocument` which is not
  > correct since it violates the Factur-X specification."
  >
  > „The required trailing `#` character is missing in the comment in the
  > Factur-X 1.0 extension schema description which is included in the Factur-X
  > specification, but it is correctly present in the actual XMP."

  <https://github.com/atgp/factur-x/blob/master/xmp/Factur-X_extension_schema.xmp>

> **Falscher Namespace, den man leicht erwischt:** `urn:ferd:pdfa:…` gehört zu
> **ZUGFeRD 1.0**, nicht zu Factur-X. Ein ZUGFeRD-2-PDF mit diesem Namespace
> wird von Mustang nicht als Factur-X erkannt — berichtet in
> <https://github.com/boxesandglue/bagme/issues/11>. Die alte ZUGFeRD-2.0-Variante
> (§6.3.2, Prefix `zf`, Dateiname `zugferd-invoice.xml`, Version `2p0`) wird noch
> toleriert, ist aber deprecated.

#### Vollständige XMP-Vorlage

Die verbreitete Referenzvorlage (ursprünglich von PDFlib GmbH, 2013–2014) liegt
in `atgp/factur-x`, `xmp/Factur-X_extension_schema.xmp`. Kern:

```xml
<rdf:Description rdf:about=""
    xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>BASIC</fx:ConformanceLevel>
</rdf:Description>

<rdf:Description rdf:about=""
    xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
    xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
 <pdfaExtension:schemas>
  <rdf:Bag>
   <rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property>
     <rdf:Seq>
      <rdf:li rdf:parseType="Resource">
       <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
       <pdfaProperty:valueType>Text</pdfaProperty:valueType>
       <pdfaProperty:category>external</pdfaProperty:category>
       <pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description>
      </rdf:li>
      <!-- DocumentType, Version, ConformanceLevel analog -->
     </rdf:Seq>
    </pdfaSchema:property>
   </rdf:li>
  </rdf:Bag>
 </pdfaExtension:schemas>
</rdf:Description>
```

Dasselbe Muster findet sich wortgleich in der Mustangproject-Beispieldatei —
nur heißt dort `pdfaSchema:schema` „ZUGFeRD PDFA Extension Schema" statt
„Factur-X PDFA Extension Schema", bei identischer Namespace-URI. Der
Schema-**Name** ist offenbar nicht streng normiert.

### Aktuelle Fassung und Änderungen am Container

| Fassung           | Factur-X   | Veröffentlicht | Änderung am **Container** |
| ----------------- | ---------- | -------------- | ------------------------- |
| ZUGFeRD 2.3.3     | 1.07.3     | 07.05.2025     | —                         |
| ZUGFeRD 2.4       | 1.08       | 04.12.2025     | nicht geprüft             |
| ZUGFeRD 2.5       | 1.09       | 10.06.2026     | nicht geprüft             |
| **ZUGFeRD 2.5.2** | **1.09.2** | **04.08.2026** | **keine**                 |

Die FeRD-Pressemitteilung vom 04.08.2026 (Eschborn | Paris, gemeinsam mit
FNFE-MPE) bezeichnet 2.5.2 ausdrücklich als **Korrigendum**, das „vor allem
Inkonsistenzen" in einer in 2.5 ergänzten Funktion des **EXTENDED**-Profils
bereinigt; diese Funktion stammt aus der kommenden EN 16931-1:2026 und stützt
die französische B2B-Reform.
<https://www.ferd-net.de/aktuelles-veranstaltungen/aktuelles/news/zugferd-252-veroeffentlicht>

kaltblut `docs/2.5.2.md` präzisiert für die Trägerseite:

> „**Carrier side:** No changes. Sections 1–6 are textually identical to 1.09,
> and the BR-HYBRID rules and severities are unchanged."

Neu in 1.09.2 ist allein **BR-FX-DE-04** (Warning, DE) zum Liefer-/Leistungsdatum
— eine **XML-Inhaltsregel**, keine Container-Regel.

**Das ist eine gute Nachricht für die Planung:** Der PDF-Teil eines
ZUGFeRD-Features ist gegenüber Spec-Updates stabil. Was sich ändert, ist das XML.

Nächstes Release: **Herbst 2026** angekündigt, voraussichtlich mit Unterstützung
für Bruttorechnungen.

> **Nicht abschließend belegt:** Ob sich zwischen 2.3.3 und 2.5 am Container
> etwas geändert hat, habe ich nicht geprüft — die älteren Spezifikationen sind
> nicht mehr herunterladbar. Da ein ZUGFeRD-2.0.1-Dokument von 2019 (Beispiel A
> oben stammt von 2020) noch heute dieselbe Struktur zeigt, ist Stabilität
> plausibel, aber nicht bewiesen.

---

## Frage 3: Die Profile

### Übersicht

| Profil                        | Inhalt                                          | Rechnungspositionen? | EN-16931-konform?         |
| ----------------------------- | ----------------------------------------------- | -------------------- | ------------------------- |
| **MINIMUM**                   | Nur Kopfdaten und Summen — Buchungshilfe        | **nein**             | nein                      |
| **BASIC WL**                  | Kopf- und Zahlungsdaten, keine Positionen       | **nein**             | nein                      |
| **BASIC**                     | Untermenge von EN 16931 mit Positionen          | ja                   | ja (Teilmenge)            |
| **EN 16931** (früher COMFORT) | Der vollständige EN-16931-Kern                  | ja                   | ja                        |
| **EXTENDED**                  | EN 16931 plus branchenspezifische Erweiterungen | ja                   | ja (conformant extension) |
| **XRECHNUNG**                 | Deutsche CIUS von EN 16931, hybrid verpackt     | ja                   | ja (CIUS)                 |

### Was ist in Deutschland zulässig?

**Primärquelle: BMF-Schreiben vom 15.10.2025**, GZ `III C 2 - S 7287-a/00019/007/243`,
DOK `COO.7005.100.4.13163130`, 33 Seiten. Es ändert den
Umsatzsteuer-Anwendungserlass. **UStAE Abschnitt 14.1 Abs. 14 Satz 4** (neu),
wörtlich aus dem BMF-PDF:

> „⁴Beispielsweise das hybride Format **ZUGFeRD ab der Version 2.0.1 —
> ausgenommen die Profile MINIMUM und BASIC-WL** — beruht auf der Normenreihe
> EN 16931 und fällt somit unter die zulässigen E-Rechnungs-Formate."

<https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf>
(Seite 12 des PDF; dieselbe Aussage steht bereits im Vorgängerschreiben vom
15.10.2024, BStBl I S. 1320, **Rn. 30**.)

Der Grund: MINIMUM und BASIC WL enthalten **keine Rechnungspositionen** und
erfüllen damit die Pflichtangaben der EN 16931 nicht.

Die Spezifikation selbst zieht denselben Schluss, und zwar als **Fatal-Regel**:

- **BR-HYBRID-DE-01** (Fatal): „DE↔DE: MINIMUM profile SHALL NOT be used."
- **BR-HYBRID-DE-02** (Fatal): „DE↔DE: BASIC WL profile SHALL NOT be used."
- **BR-HYBRID-FR-01** (Fatal): „FR↔FR: XRECHNUNG profile SHALL NOT be used."

Quelle: kaltblut `docs/2.5.2.md`. _(Die DE-Regeln decken sich mit dem
BMF-Schreiben; die FR-Regel ist **nicht abschließend belegt**.)_

Dazu kommt, ebenfalls aus dem BMF-Schreiben vom 15.10.2025, **UStAE Abschnitt
14.4 Abs. 3**, wörtlich:

> „⁵Bei einem hybriden Format bilden die im strukturierten Teil vorliegenden
> Rechnungsdaten den **führenden Teil**. ⁶Im Fall von Abweichungen zwischen den
> strukturierten Rechnungsdaten und den sonstigen Informationen im Bildteil
> gehen die Daten des strukturierten Teils denen der Bilddatei vor."

Und, für eine PDF-Library besonders ernüchternd:

> „³Die zusätzliche Erstellung eines menschenlesbaren Dokuments ist **nicht
> erforderlich**."

### Aufwand der XML-Erzeugung je Profil

| Profil                | Geschätzter XML-Umfang | Gemessen                                                |
| --------------------- | ---------------------: | ------------------------------------------------------- |
| MINIMUM               |                ~2,8 KB | **2 819 Bytes** — Beispiel B, extrahiert                |
| EN 16931              |                ~9,5 KB | **9 439 Bytes** — Beispiel A, `/Length` am EmbeddedFile |
| EN 16931, realistisch |                8–35 KB | CEN-Beispieldateien, s. u.                              |

Die MINIMUM-Datei umfasst vollständig: `ExchangedDocumentContext` (Guideline-ID),
`ExchangedDocument` (Nummer, Typcode 380, Datum), `SellerTradeParty` und
`BuyerTradeParty` (je Name, Legal Organization, Land, USt-ID),
`BuyerOrderReferencedDocument`, leeres `ApplicableHeaderTradeDelivery` und eine
`SpecifiedTradeSettlementHeaderMonetarySummation` mit vier Beträgen. **Keine
einzige Position.** Das ist in einer Stunde handgeschrieben — und in Deutschland
rechtlich wertlos.

**Welches Profil wäre der sinnvollste Einstiegspunkt für eine Library?**

Fachliche Einschätzung, mit Begründung:

1. **MINIMUM und BASIC WL scheiden aus.** Sie sind in Deutschland keine
   E-Rechnung (BMF, s. o.) und werden von der Spezifikation für DE↔DE als
   Fatal-Fehler geführt. Eine Library, die nur MINIMUM kann, löst das Problem
   ihrer Nutzer nicht — sie produziert ein Dokument, das aussieht wie eine
   E-Rechnung und keine ist. Das ist schlimmer als kein Feature.
2. **BASIC ist der kleinste zulässige Einstieg**, aber der Abstand zu EN 16931
   ist in der Implementierung gering: beide brauchen Positionen, Steueraufteilung,
   Zahlungsbedingungen und die vollständige Summenlogik. Wer BASIC baut, hat 80 %
   von EN 16931.
3. **EXTENDED und XRECHNUNG scheiden als _Einstieg_ aus.** EXTENDED bewegt sich
   mit jeder Spec-Version (2.5.2 ist genau deswegen erschienen); XRECHNUNG bringt
   die KoSIT-CIUS-Regeln zusätzlich ins Spiel.
4. **Für den PDF-Container ist die Profilwahl ohnehin fast irrelevant.** Sie
   wirkt auf genau zwei Bytes-Mengen: den Wert von `fx:ConformanceLevel` und den
   Default für `/AFRelationship`. Das ist eine Enum, kein Arbeitspaket.

→ **Wenn fast-pdf nur den Container liefert, ist „Einstiegsprofil" keine
Entscheidung, die fast-pdf treffen muss** — sie wird vom Aufrufer getroffen, der
das XML mitbringt. Das ist ein starkes Argument für den Schnitt in Frage 4.

---

## Frage 4: PDF-Container vs. XML — wo schneiden?

### Wie groß ist die XML-Seite wirklich?

Gemessen an den offiziellen CEN-Validierungsartefakten,
**Release `validation-1.3.17`, veröffentlicht 2026-10-12**,
Asset `en16931-cii-1.3.17.zip` (227 817 Bytes),
<https://github.com/ConnectingEurope/eInvoicing-EN16931/releases>:

| Kennzahl                                           |                  Wert | Wie gemessen                                                                                      |
| -------------------------------------------------- | --------------------: | ------------------------------------------------------------------------------------------------- |
| Schematron-Assertions (CII, preprocessed)          |               **810** | `grep -o '<assert' schematron/preprocessed/EN16931-CII-validation-preprocessed.sch`               |
| Schematron-Regeln (`<rule>`)                       |               **115** | ebd.                                                                                              |
| davon `flag="fatal"`                               |               **362** | ebd.                                                                                              |
| davon `flag="warning"`                             |               **471** | ebd.                                                                                              |
| Syntaxregeln `CII-SR-*`                            |               **484** | Auswertung der `id`-Attribute                                                                     |
| Datentypregeln `CII-DT-*`                          |               **103** | ebd.                                                                                              |
| Semantische Geschäftsregeln `BR-*` (alle Familien) |              **~190** | ebd. (BR 58, BR-CO 23, BR-CL 23, BR-DEC 21, BR-O 14, BR-IC 12, BR-Z/S/IP/IG/G/E/AE je 10, BR-B 2) |
| Größe der preprocessed Schematron                  |         241 696 Bytes | `ls -l`                                                                                           |
| Beispielrechnungen im Paket                        | 8 779 – 111 526 Bytes | `ls -l examples/`                                                                                 |

Zum Vergleich: die **gesamte** Container-Arbeit aus Frage 2 besteht aus fünf
PDF-Dictionaries, einem Namensbaum mit einem Eintrag und ~60 Zeilen XMP.

**Das Verhältnis ist etwa 1 : 10 bis 1 : 20.** Eine CII-Erzeugung, die
EN-16931-konform ist, muss:

- das semantische Modell abbilden (~170–176 Business Terms — _Zahl aus
  Sekundärquellen, nicht aus dem CEN-Normtext, daher **nicht abschließend
  belegt**_),
- auf die CII-D16B-Syntax mappen (die 484 `CII-SR-*`-Regeln sind genau das:
  Syntax-Bindungsregeln),
- Datentypen und Codelisten korrekt setzen (103 `CII-DT-*`, 23 `BR-CL-*`),
- **die Rechenlogik korrekt beherrschen** — das ist der unterschätzte Teil:
  `BR-CO-*` (23 Regeln) und `BR-DEC-*` (21 Regeln) prüfen Summenbildung,
  Rundung und Dezimalstellen; die Steuerkategorie-Familien (`BR-S`, `BR-Z`,
  `BR-E`, `BR-AE`, `BR-IC`, `BR-G`, `BR-IG`, `BR-IP`, `BR-O` — je ~10 Regeln)
  prüfen die umsatzsteuerliche Konsistenz je Kategorie.

Letzteres ist **Steuerfachlogik, nicht PDF-Technik.** Eine Rundungsregel wie
BR-CO-10 hat mit Typografie, Glyphen und Byte-Offsets nichts zu tun. Und
rechtlich steht einiges daran: Nach dem BMF-Schreiben vom 15.10.2025 (Rn. 6a/6b)
führt ein **Formatfehler oder ein Geschäftsregelfehler** dazu, dass die Datei
die Anforderungen an eine E-Rechnung **nicht** erfüllt und nur eine sonstige
Rechnung ist — siehe [`stichtage-rechtslage.md`](./stichtage-rechtslage.md).

### Der saubere Schnitt

**Ja, es gibt ihn, und er liegt an einer natürlichen Fuge:**

```
Aufrufer                          fast-pdf
────────                          ────────
CII-XML erzeugen       ──────▶    doc.attachFacturX(xml: Uint8Array, {
(eigene Logik, oder                  profile: 'EN 16931',
 node-zugferd,                       relationship?: 'Alternative',
 @stackforge-eu/factur-x,            filename?: 'factur-x.xml',
 @lucaapp/zugferd-ts,                desc?: string
 eigener Mapper)                  })
                                  + PDF/A-3b-Modus
```

Argumente für diesen Schnitt:

1. **Er folgt der Marktstruktur.** Jedes existierende JS-Paket fällt in genau
   eine der beiden Rollen — siehe [`stand-der-technik-js.md`](./stand-der-technik-js.md).
   Es gibt bereits mehrere XML-Erzeuger auf npm; was fehlt, ist ein kleiner
   Generator, der ein **PDF/A-taugliches** PDF erzeugt.
2. **Er spielt die eine Stärke aus, die die Anhänge-Pakete prinzipiell nicht
   haben.** `node-zugferd`, `@stackforge-eu/factur-x` und die Python-Referenz
   `factur-x` hängen XML an ein _fertiges_ PDF an — sie erreichen Fonts,
   Farbräume und Transparenz im Seiteninhalt gar nicht und können PDF/A deshalb
   nur **konservieren, nicht herstellen**. Die Python-Referenz sagt das seit
   v0.5 selbst: „fully PDF/A-3 compliant **when the input PDF file is PDF/A
   compliant**". Wer Seiten _und_ Container in einem Prozess hat, löst ein
   Problem, das die andere Gruppe nicht lösen kann.
3. **Er hält Steuerfachlogik aus einer PDF-Library heraus.** Rundungsregeln,
   Steuerkategorien und Codelisten ändern sich mit jeder EN-16931-Fassung
   (EN 16931-1:2026 steht an) und mit nationalen CIUS. Das in ein Paket zu
   nehmen, das sonst nur Bytes schreibt, erzeugt eine Wartungslast, die nichts
   mit PDF zu tun hat.
4. **Er ist versionsstabil.** Der Container hat sich zwischen 1.09 und 1.09.2
   nicht geändert; das XML schon.
5. **Er passt zur Bundle-Größe.** Container: ICC-Profil 456 Bytes + XMP-Template
   - fünf Dictionaries. XML-Erzeugung: das CII-Datenmodell allein ist
     Kilobytes an Mapping-Tabellen.

**Was fast-pdf dabei trotzdem leisten sollte**, damit der Schnitt nicht zur
Ausrede wird:

- `fx:ConformanceLevel` aus dem übergebenen Profil-Enum setzen und gegen die
  sechs zulässigen Werte validieren (BR-HYBRID-07, Fatal).
- Den Dateinamen auf `factur-x.xml` / `xrechnung.xml` festnageln
  (BR-HYBRID-13, Fatal) und mit `fx:DocumentFileName` konsistent halten
  (BR-HYBRID-14).
- Den `/AFRelationship`-Default aus der Matrix ableiten.
- Prüfen, dass das übergebene XML wohlgeformt ist und sein
  `GuidelineSpecifiedDocumentContextParameter/ID` zum angegebenen Profil passt
  (BR-HYBRID-15, Warning) — das ist ein 20-Zeilen-Check, kein XML-Parser.

**Was fast-pdf _nicht_ tun sollte:** das XML erzeugen, es gegen XSD oder
Schematron validieren, oder ein bestehendes Fremd-PDF nach PDF/A-3 konvertieren.
Für Letzteres gibt es im gesamten JS-Ökosystem keine Lösung — nur Mustangproject
(Java) kann es.

---

## Risiken & offene Punkte

1. **Die Spezifikation lag nicht vor.** Alle BR-HYBRID-Zitate stammen aus
   kaltblut `docs/2.5.2.md`, das sich selbst als Zusammenfassung von
   `0_FACTUR-X_1.09.2_EN.pdf` bezeichnet und zum Gegenlesen rät. Für eine
   Implementierungsentscheidung ist die Faktenlage belastbar (drei unabhängige
   Stränge stimmen überein), **für eine Abnahme sollte die Spec beschafft
   werden** — sie kostet nur eine E-Mail-Adresse bei FNFE-MPE.
2. **`/Params` kollidiert mit `deterministic`.** `/ModDate` ist SOLL, aber ein
   Zeitstempel bricht fast-pdfs byte-stabile Ausgabe. Lösbar wie beim Info-Dict
   (`src/document/document.ts:3522`), aber eine bewusste Entscheidung.
3. **Das Versprechen in README und `SECURITY.md`** („keine eingebetteten
   Dateien") steht im direkten Widerspruch zu diesem Feature. Es muss
   umformuliert werden — nicht ergänzt. Dazu kommt
   `src/document/document.ts:760`, wo ausdrücklich verhindert wird, dass eine
   importierte PDF „a file attachment or a `/JavaScript` action" einschleust;
   diese Härtung bleibt richtig, aber die Formulierung „fast-pdf erzeugt keine
   Anhänge" wird falsch.
4. **BR-HYBRID-FR-01** (XRECHNUNG ist für FR↔FR verboten) stammt nur aus Strang 3
   — **nicht abschließend belegt**, für den deutschen Markt aber irrelevant.
5. **Die „170–176 Business Terms"** stammen aus Sekundärquellen. Die belastbaren
   Zahlen sind die selbst gezählten Schematron-Regeln.
6. **Zwei Beispieldateien sind eine kleine Stichprobe.** `ZUGFeRD/corpus` enthält
   weitere Verzeichnisse (`PHP_@gpFacturX`, `intarsys`, `symtrax`) und einen
   `fail/`-Zweig mit absichtlich fehlerhaften Dateien — Letzterer wäre ein
   exzellenter Negativ-Testkorpus für eine CI.

## Grobe Aufwandsschätzung

> **Schätzung.** Setzt voraus, dass die Blöcke aus
> [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md) (11–22 PT) bereits
> erledigt sind. Ohne PDF/A-3b ist dieser Teil wertlos.

| Block | Inhalt                                                                                                                                                | PT (Schätzung) |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------: |
| ZF-1  | Generische `attach()`-API: Filespec (`/F`, `/UF`, `/Subtype`, `/Desc`, `/Params`), `EmbeddedFile`-Stream, `/Names → /EmbeddedFiles`, `/AF` am Katalog |            1–2 |
| ZF-2  | Factur-X-Aufsatz: Profil-Enum, Dateinamen-Zwang, `/AFRelationship`-Matrix, XMP-Extension-Schema ins XMP-Template einhängen                            |              1 |
| ZF-3  | Leichtgewichtige Plausibilitätsprüfung des übergebenen XML (wohlgeformt, Guideline-ID passt zum Profil)                                               |            0,5 |
| ZF-4  | Testkorpus: Positivfälle gegen Mustang, Negativfälle aus `ZUGFeRD/corpus/ZUGFeRDv2/fail/`                                                             |            1–2 |
|       | **Summe ZUGFeRD-Container, auf PDF/A-3b aufsetzend**                                                                                                  | **3,5–5,5 PT** |
| —     | **CII-/EN-16931-XML-Erzeugung, falls doch gewünscht**                                                                                                 |   **15–30 PT** |

Die letzte Zeile ist bewusst grob: 810 Assertions, davon ~190 semantische
Geschäftsregeln inklusive Rundungs- und Steuerkategorielogik, plus Codelisten,
plus ein Mapping auf CII D16B. 15 PT wären ein sehr geradliniger Durchlauf nur
für BASIC; 30 PT sind realistisch, wenn EN 16931 vollständig und
schematron-grün sein soll. **Das ist kein Nebenprojekt zu einem PDF-Writer.**

## Quellen

**Spezifikation und Herausgeber**

- FeRD, „ZUGFeRD 2.5.2 veröffentlicht" (04.08.2026) — <https://www.ferd-net.de/aktuelles-veranstaltungen/aktuelles/news/zugferd-252-veroeffentlicht>
- FeRD, ZUGFeRD 2.5.2 (deutsch / englisch) — <https://www.ferd-net.de/en/downloads/publications/details/zugferd-252-english>
- FeRD, Versionsarchiv — <https://www.ferd-net.de/en/standards/zugferd/factur-x/zugferd-version-archive>
- FNFE-MPE, Factur-X-Downloads (E-Mail erforderlich) — <https://fnfe-mpe.org/factur-x/>
- `phax/kaltblut`, `docs/2.5.2.md` (BR-HYBRID-Regeln, Sekundärquelle) — <https://github.com/phax/kaltblut/blob/main/docs/2.5.2.md>

**Empirische Belege**

- `ZUGFeRD/corpus`, Apache-2.0 — <https://github.com/ZUGFeRD/corpus>
  - `ZUGFeRDv2/correct/Mustangproject/MustangGnuaccountingBeispielRE-20201121_508.pdf`
  - `ZUGFeRDv2/correct/FNFE-factur-x-examples/Facture_FR_MINIMUM.pdf`
  - Beide am 30.10.2026 heruntergeladen und byteweise analysiert.
- `atgp/factur-x`, `xmp/Factur-X_extension_schema.xmp` (PDFlib-Vorlage mit Namespace-Kommentar) — <https://github.com/atgp/factur-x/blob/master/xmp/Factur-X_extension_schema.xmp>
- `boxesandglue/bagme` Issue #11 (falscher ZUGFeRD-1.0-Namespace) — <https://github.com/boxesandglue/bagme/issues/11>

**EN 16931 / CII**

- CEN/TC 434 Validierungsartefakte, Release `validation-1.3.17` (12.10.2026) — <https://github.com/ConnectingEurope/eInvoicing-EN16931/releases>
  - Eigene Auszählung von `en16931-cii-1.3.17.zip`, 30.10.2026.

**Recht**

- BMF-Schreiben vom 15.10.2025, GZ III C 2 - S 7287-a/00019/007/243 — <https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf>
  (UStAE Abschn. 14.1 Abs. 14 Satz 4; Abschn. 14.4 Abs. 3)
- BMF-Schreiben vom 15.10.2024, BStBl I S. 1320, Rn. 30 — siehe [`stichtage-rechtslage.md`](./stichtage-rechtslage.md)

**Eigene Quellcode-Analyse** — fast-pdf 0.8.1, Commit `cd9f9ff`
