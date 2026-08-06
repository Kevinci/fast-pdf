# Wie `append()` angehängte PDFs prüft und filtert

Technischer Bericht zu fast-pdf ≥ 0.7.0 · Stand 2026-08-05

`append()` hängt die Seiten eines **fremden** PDFs an ein generiertes Dokument.
Damit liest die Bibliothek erstmals Dateien, die sie nicht selbst geschrieben
hat — in der Praxis Uploads von Endnutzern. Dieser Bericht beschreibt, was dabei
konkret passiert: was übernommen wird, was verworfen wird, warum, und wie man
das **selbst nachprüfen** kann, ohne fast-pdf glauben zu müssen.

Wer nur die Kurzfassung braucht: [Kapitel 6](#6--warum-man-im-ergebnis-noch-links-hover-und-einen-seitensprung-sieht)
erklärt die drei Beobachtungen, die regelmäßig für den Verdacht sorgen, der
Filter arbeite nicht.

---

## 1 · Was in einem PDF überhaupt gefährlich ist

Ein PDF ist kein Bild, sondern ein Objektgraph mit Verhalten. Ein Angreifer
braucht keine Lücke im Leser — die folgenden Konstrukte sind **spezifiziert**
und werden von gängigen Betrachtern ausgeführt:

| Konstrukt                                          | Wirkung                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `/OpenAction`                                      | Aktion beim Öffnen des Dokuments — typischerweise JavaScript |
| `/Names /JavaScript`                               | Skript im Namensbaum des Katalogs, läuft automatisch         |
| `/AA` (Additional Actions)                         | Trigger bei Seitenaufruf, Fokus, **Mouseover**, Schließen    |
| `/A /S /JavaScript`                                | JavaScript beim Klick auf eine Annotation                    |
| `/A /S /Launch`                                    | startet ein lokales Programm                                 |
| `/A /S /SubmitForm`                                | schickt Daten an einen fremden Server                        |
| `/A /S /ImportData`                                | liest eine lokale Datei ein                                  |
| `/A /S /GoToR`, `/GoToE`                           | Sprung in eine fremde oder eingebettete Datei                |
| `javascript:` in `/URI`                            | Skript-URI in einem scheinbar normalen Link                  |
| `/FileAttachment` + `/EmbeddedFile`                | eine Datei im Dokument — der Anhang im Anhang                |
| `/Widget` + `/AcroForm`, `/XFA`                    | Formularfelder, XFA bringt eine eigene Skript-Engine mit     |
| `/Screen`, `/Movie`, `/Sound`, `/RichMedia`, `/3D` | Medienobjekte mit eigenen Abspielpfaden                      |

Dazu kommen Ressourcenangriffe, die kein Verhalten brauchen: Dekompressions­bomben,
absichtlich kaputte Querverweistabellen, Referenzzyklen und extrem tief
verschachtelte Objekte.

**Der entscheidende Punkt:** würde man eine Seite naiv „hinüberkopieren", käme
das alles mit — in das Dokument, das _unter dem Briefkopf des Absenders_ beim
Empfänger landet. Genau deshalb kopiert `append()` eine Seite nicht als Ganzes.

---

## 2 · Das Verfahren in fünf Schritten

```
Upload  →  1. Struktur lesen   (src/pdf/reader.ts)
           2. Seitenbaum auflösen
           3. Seiten-Dictionary neu aufbauen   ← Whitelist
           4. Annotationen einzeln prüfen      ← Whitelist + Aktionsprüfung
           5. Inhalt byteweise kopieren        (nie dekodiert, nie ausgeführt)
        →  Ausgabe
```

### Schritt 1 — Struktur lesen, nicht ausführen

Der Reader (`src/pdf/reader.ts`) versteht klassische xref-Tabellen,
xref-Streams und Objekt-Streams (PDF 1.5+) mit PNG-/TIFF-Predictor. Er ist ein
reiner Parser: er baut Datenstrukturen, er interpretiert keine Aktionen und
führt nichts aus.

Verschlüsselte Dateien werden **abgelehnt**, nicht geraten — `FastPDFError` mit
`code: "ENCRYPTED_PDF"`. Eine Datei, deren Querverweistabelle beschädigt oder
veraltet ist, wird durch Absuchen der Datei nach Objekten gerettet; das ist eine
Robustheitsmaßnahme für echte Uploads und **keine** Sicherheitsgrenze — sie
ändert nur, _welche_ Objekte gefunden werden, niemals was sie enthalten dürfen.

### Schritt 2 — Seitenbaum auflösen

Der Katalog des Quelldokuments wird **nur benutzt, um die Seiten zu finden**.
Er selbst wird nie kopiert. Damit fallen ohne weitere Prüfung weg:
`/OpenAction`, `/Names /JavaScript`, `/AcroForm`, `/XFA`,
`/Names /EmbeddedFiles`, `/OCProperties` und alle sonstigen dokumentweiten
Einstellungen der Quelle.

Vererbte Seitenattribute (`/Resources`, `/MediaBox`, `/CropBox`, `/Rotate`)
werden auf der Zielseite materialisiert, weil der Quell-Seitenbaum nicht
mitkommt — sonst würde eine Seite, die `/Rotate 90` vom Elternknoten geerbt hat,
falsch orientiert erscheinen.

### Schritt 3 — Seiten-Dictionary: Whitelist statt Blacklist

Eine Seite wird **neu aufgebaut**, nicht übernommen. Nur diese Schlüssel werden
kopiert (`PAGE_KEYS` in `src/pdf/import.ts`):

```
Contents · Resources · MediaBox · CropBox · BleedBox · TrimBox · ArtBox
Rotate · Group · UserUnit
```

Alles andere existiert im Ergebnis nicht. Insbesondere **`/AA` (Seiten-Trigger)
kommt nie mit**, ebenso `/StructParents`, `/PieceInfo`, `/B` und
applikationsspezifische Schlüssel. `/Parent` und `/Annots` setzt fast-pdf selbst.

Eine Whitelist ist hier bewusst gewählt: bei einer Blacklist wäre jedes neue
oder übersehene PDF-Feature automatisch erlaubt. Bei einer Whitelist ist es
automatisch verboten. Der Preis ist, dass legitime Exoten verloren gehen — das
ist der richtige Preis.

### Schritt 4 — Annotationen: Typ- und Aktionsprüfung

Jede Annotation wird einzeln geprüft. Erlaubt sind nur **Markup**-Typen, also
solche, die zeichnen und sonst nichts tun (`ANNOT_SUBTYPES` in
`src/pdf/import.ts`):

```
Link · Text · FreeText · Highlight · Underline · StrikeOut · Squiggly
Square · Circle · Line · Polygon · PolyLine · Stamp · Ink · Caret
```

Damit fallen `/Widget` (Formularfelder), `/FileAttachment`, `/Sound`, `/Movie`,
`/RichMedia`, `/Screen`, `/3D` und `/Popup` weg — die Payload-Träger.

Beim Kopieren werden diese Schlüssel **nicht** übernommen (`ANNOT_SKIP`):

| Schlüssel                 | Grund                                                  |
| ------------------------- | ------------------------------------------------------ |
| `/AA`                     | Cursor-Trigger, u. a. JavaScript bei Mouseover         |
| `/A`                      | nur, wenn die Prüfung unten scheitert                  |
| `/P`, `/Parent`, `/Popup` | zeigen auf Objekte, die nicht mitkommen                |
| `/Rect`, `/QuadPoints`    | werden neu berechnet (bei `fit: "page"` transformiert) |

Eine verbleibende Aktion (`/A`) muss **eine von genau zwei** Formen haben:

1. `/S /URI` mit einem Ziel, das die gleiche Schema-Prüfung besteht wie
   `link()` — `javascript:`, `vbscript:`, `data:` und `file:` sind gesperrt,
   auch getarnt mit Steuerzeichen (`blockedUriScheme()` in `src/validate.ts`).
2. `/S /GoTo` mit einem Ziel **innerhalb der importierten Seiten**. Der Verweis
   wird auf die neue Seitennummer umgebogen. Zeigt er auf eine Seite, die nicht
   mitkommt, wird die Annotation verworfen.

Alles andere — `/Launch`, `/JavaScript`, `/SubmitForm`, `/ImportData`,
`/GoToR`, `/GoToE`, `/Rendition`, `/Movie`, `/Sound`, `/Hide`, `/Named`,
`/SetOCGState` — führt dazu, dass die Annotation wegfällt. Ebenso benannte
Destinationen (`/Dest (name)`), weil der Namensbaum der Quelle nicht mitkommt
und der Verweis ins Leere zeigen würde.

Seit 0.7.1 gilt zusätzlich: ein `/Link`, der nach der Filterung **weder `/A` noch
`/Dest`** hat, wird ebenfalls verworfen. Er wäre harmlos, aber ein Betrachter
zeigt über einem Link-Rechteck weiterhin einen Hand-Cursor — was beim Prüfen
aussieht, als hätte der Filter nicht gegriffen. Siehe [Kapitel 6](#6--warum-man-im-ergebnis-noch-links-hover-und-einen-seitensprung-sieht).

### Schritt 5 — Inhalt: kopiert, nicht dekodiert

Content-Streams wandern **byteweise samt ihren Filtern** in die Ausgabe. Sie
werden nicht dekomprimiert, nicht umgeschrieben und in keinem Sinne ausgeführt —
ein Content-Stream ist eine Folge von Zeichenanweisungen, und fast-pdf
interpretiert sie nicht. Das hat zwei Konsequenzen:

- Die Seite sieht danach **exakt** aus wie vorher und bleibt so klein wie vorher.
- Kein Filter jenseits von `/FlateDecode` muss verstanden werden, was die
  Angriffsfläche des Parsers klein hält.

Es folgt aber auch: **sichtbarer Text auf der Seite bleibt unverändert stehen.**
Auch dann, wenn er wie ein Angriff aussieht. Das ist die häufigste Quelle für
Fehlalarm — siehe Kapitel 6.

---

## 3 · Harte Grenzen gegen Ressourcenangriffe

| Grenze                     | Wert            | Wirkung                                                           |
| -------------------------- | --------------- | ----------------------------------------------------------------- |
| Dekomprimierte Streamgröße | 64 MB je Stream | Dekompressionsbombe scheitert, statt Speicher zu fressen          |
| Objektverschachtelung      | 128 Ebenen      | tief verschachtelte Arrays/Dictionaries laufen nicht in den Stack |
| Referenzzyklen             | erkannt         | „Seite zeigt auf Elternknoten zeigt auf Seite" terminiert         |
| Objektzahl im Seitenbaum   | 20 000          | Endlos-Kids-Ketten laufen nicht ewig                              |
| Verschlüsselte Quelle      | abgelehnt       | keine Rateversuche, klarer Fehlercode                             |

Nicht durch die Bibliothek abgedeckt und **Aufgabe der Anwendung**: Upload-Größe
und Seitenzahl. Genau dafür gibt es `pdfInfo()` — es liest Seitenzahl,
Seitengrößen und Verschlüsselungsstatus, ohne etwas zu importieren:

```ts
const info = await pdfInfo(uploadBytes);
if (info.encrypted) return "Bitte zuerst den Passwortschutz entfernen.";
if (info.pageCount > 20) return "Bitte höchstens 20 Seiten.";
await pdf.append(uploadBytes);
```

---

## 4 · Was `append()` ausdrücklich **nicht** ist

Damit die Erwartung stimmt:

- **Kein Virenscanner.** Es wird nicht nach Schadsoftware gesucht, sondern eine
  eng definierte Menge von Strukturen übernommen und alles andere weggelassen.
- **Keine Garantie.** Ein Whitelist-Ansatz ist robust gegen unbekannte Features,
  aber Software hat Fehler. Ein Fund wird über
  [SECURITY.md](../SECURITY.md) gemeldet und behoben.
- **Keine Entschlüsselung.** Geschützte Dateien werden abgelehnt.
- **Keine Übernahme von** Formularfeldern, Lesezeichen, Tag-Struktur
  (`StructTreeRoot`), Ebenen (`/OCProperties`) und Dokumentmetadaten der Quelle.
- **Keine Bearbeitung.** Text auf einer importierten Seite kann nicht geändert
  oder entfernt werden. Wer Inhalte schwärzen muss, braucht ein anderes Werkzeug.

---

## 5 · Selbst nachprüfen

Der Verdacht „das passiert doch gar nicht" ist berechtigt, solange man es nicht
gesehen hat. Es gibt drei Wege, unterschiedlich aufwändig.

### 5.1 Unabhängiger Struktur-Audit (empfohlen)

`scripts/audit-pdf.mjs` ist **pures Node ohne jede Abhängigkeit zu fast-pdf** —
eine zweite Meinung, die der Bibliothek nichts glaubt. Es entfernt zuerst alle
Stream-Nutzdaten (damit sichtbarer Text keine Treffer erzeugt) und durchsucht
dann das Objektgerüst.

```
npm run hostile                       # erzeugt examples/output/hostile.pdf
npx tsx examples/append.ts            # oder eigenes Skript mit append()
node scripts/audit-pdf.mjs examples/output/hostile.pdf ergebnis.pdf
```

Reales Ergebnis für das Testdokument aus diesem Repository:

```
examples/output/hostile.pdf  ·  8.139 Bytes  ·  30 Objekte
  ⚠   1×  /OpenAction      Aktion, die beim Öffnen des Dokuments ausgeführt wird
  ⚠   2×  /AA              Additional Actions: Trigger bei Seitenaufruf, Fokus, Mouseover
  ⚠   6×  /JavaScript      JavaScript-Aktion
  ⚠   5×  /JS              JavaScript-Quelltext in einer Aktion
  ⚠   1×  /Launch          startet ein externes Programm
  ⚠   1×  /SubmitForm      sendet Daten an einen Server
  ⚠   1×  /GoToR           Sprung in eine fremde Datei
  ⚠   1×  /Rendition       Medienwiedergabe-Aktion
  ⚠   1×  /EmbeddedFile    eingebettete Datei
  ⚠   1×  /FileAttachment  Dateianlage-Annotation
  ⚠   1×  /Widget          Formularfeld
  ⚠   1×  /AcroForm        Formular im Katalog
  ⚠   1×  /RichMedia       eingebettetes Medienobjekt (Flash/3D)
  ⚠   1×  /Screen          Screen-Annotation für Medien
  ⚠   1×  javascript: URI  Skript-URI in einem Link
  Annotationen: 9× /Link, 1× /FileAttachment, 1× /Widget, 1× /Screen,
                1× /RichMedia, 1× /Square, 1× /Highlight
  ⇒ 25 riskante Fundstellen

examples/output/hostile-appended.pdf  ·  5.986 Bytes  ·  17 Objekte
  Keine riskanten Strukturen gefunden.
  ·    2×  /URI             externer Weblink (harmlos, nur zur Info)
  Annotationen: 2× /Link, 1× /Square, 1× /Highlight
  ⇒ SAUBER
```

**25 riskante Fundstellen → 0.** Übrig bleiben genau vier Annotationen: der
absichtlich harmlose Weblink, der umgebogene Seitensprung und die beiden
Markup-Annotationen der Kontrollgruppe.

Grenze des Werkzeugs: Objekte in komprimierten Objekt-Streams (`/ObjStm`) sieht
es nicht, weil es keine Kompression liest. Für die _Ausgabe_ von fast-pdf ist
das ohne Belang — sie enthält nie Objekt-Streams. Bei einer Eingabedatei kann
die linke Zahl zu niedrig sein; die rechte bleibt aussagekräftig.

### 5.2 Das Testdokument selbst

`scripts/make-hostile-pdf.mjs` (`npm run hostile`) erzeugt ein PDF mit **14
gefährlichen Konstrukten**, einem Sonderfall und **drei harmlosen
Kontroll-Annotationen**. Die Kontrollgruppe ist der wichtigste Teil: ein Filter,
der auch harmlose Markup-Annotationen wegwirft, wäre nutzlos — er muss
_unterscheiden_, nicht pauschal löschen.

Jedes gefährliche Konstrukt trägt einen eindeutigen Marker (`FASTPDF_LEAK…`).
Diese Marker stehen ausschließlich in den Payloads selbst, nie im sichtbaren
Text — deshalb ist die Suche nach ihnen exakt, im Gegensatz zur Suche nach
PDF-Schlüsselnamen.

Alle Payloads sind bewusst wirkungslos: `app.alert`, eine Textdatei mit der
Endung `.exe`. Es geht um die _Strukturen_, nicht um Schadcode.

### 5.3 Im Browser, mit Sichtprüfung

`docs/append-playground.html` ist eine lokale Testseite gegen den
Browser-Build. Nach `npm run build` und `python3 -m http.server 8080` erreichbar
unter `http://localhost:8080/docs/append-playground.html`.

Der Knopf „Hostile Test-PDF laden" lädt das Dokument aus 5.2, die Vorschau zeigt
das Ergebnis, und ein Sicherheits-Check listet pro Payload ✓/✗ auf. Das Panel
erscheint nur, wenn ein Upload Marker enthält.

### 5.4 Automatisierte Tests

`tests/append.test.ts` enthält den Filter als Regressionstest, darunter eine
Annotation mit `/FileAttachment` + `/AA`-JavaScript neben einer harmlosen
`/Square`-Annotation — Letztere _muss_ überleben, sonst wäre der Test wertlos,
weil ein „alles wegwerfen" ihn ebenfalls bestehen würde.

---

## 6 · Warum man im Ergebnis noch Links, Hover und einen Seitensprung sieht

Drei Beobachtungen führen regelmäßig zum Verdacht, der Filter arbeite nicht.
Alle drei sind erklärbar; eine davon war ein berechtigter Einwand und ist in
0.7.1 behoben.

### 6.1 „Ich sehe die Links noch"

Zwei verschiedene Dinge werden hier verwechselt.

**a) Sichtbarer Text ist keine Funktion.** Das Testdokument _druckt_ die
Payload-Namen als Text auf die Seite, damit ein Mensch sieht, worum es geht —
inklusive der Zeichenfolge `javascript:alert(1)`. Seiteninhalt wird von
`append()` absichtlich unverändert kopiert (Schritt 5). Diese Zeichen sind also
weiterhin da, als Farbe auf Papier. Sie sind keine Aktion, kein Link und nicht
anklickbar. Wer im Ergebnis mit einem Texteditor nach `/JavaScript` sucht,
findet **diesen Text** und hält einen funktionierenden Filter für defekt.

> Deshalb prüft `scripts/audit-pdf.mjs` erst nach dem Entfernen aller
> Stream-Nutzdaten. Und deshalb tragen die Payloads eigene Marker.

**b) Ein Link _soll_ überleben.** Kontrolle A ist ein echter, funktionierender
Link auf `https://example.com/ok`. Ein normaler Weblink ist erlaubt — er ist der
Normalfall in jedem Zeugnis, jeder Rechnung, jedem Anschreiben. Würde `append()`
ihn entfernen, wäre die Funktion für Anlagen unbrauchbar. Er ist absichtlich im
Testdokument, um zu zeigen, dass unterschieden wird.

### 6.2 „Beim Hover passiert etwas"

Das war ein berechtigter Einwand.

In **0.7.0** blieb eine Annotation übrig, deren gesamtes Verhalten in `/AA`
steckte (JavaScript bei Mouseover). Das `/AA` wurde korrekt entfernt — die
Aktion war also weg und beim Klick passierte nichts. Zurück blieb aber das
**Link-Rechteck ohne Ziel**, und darüber zeigen Betrachter weiterhin einen
Hand-Cursor oder eine Umrandung. Wirkungslos, aber verständlicherweise
beunruhigend.

In **0.7.1** wird ein `/Link` ohne `/A` und ohne `/Dest` mitverworfen. Vorher
und nachher, strukturell ausgelesen:

```
0.7.0   Seite 2: 5 Annotationen
        /Link  [48 674 300 688]   keine Aktion     ← wirkungsloses Rechteck
        /Link  [48 578 300 592]   /A /S /GoTo → Seite 3
        /Link  [48 316 300 330]   /A /S /URI → https://example.com/ok
        /Square, /Highlight

0.7.1   Seite 2: 4 Annotationen
        /Link  [48 578 300 592]   /A /S /GoTo → Seite 3
        /Link  [48 316 300 330]   /A /S /URI → https://example.com/ok
        /Square, /Highlight
```

Wichtig für die Einordnung: das JavaScript war **in beiden Versionen weg**. Der
Unterschied ist der leere Rahmen, nicht die Sicherheit.

Es bleibt ein Hover-Effekt, der korrekt ist: über Kontrolle A (echter Weblink)
und über dem Seitensprung aus 6.3 zeigt der Betrachter einen Cursor, weil dort
tatsächlich ein funktionierender Link liegt.

### 6.3 „Es wird zur zweiten Seite gescrollt"

Das ist beabsichtigt und harmlos.

Das Testdokument enthält einen `/GoTo`-Link auf seine eigene Seite 2. Ein Sprung
**innerhalb der importierten Seiten** ist unschädlich: er verlässt das Dokument
nicht, lädt nichts nachträglich und führt nichts aus. Er wird auf die neue
Seitennummer umgebogen — im Beispiel oben zeigt er auf Seite 3 der Ausgabe, weil
die Quellseite 2 dort gelandet ist.

Würde `append()` solche Sprünge entfernen, wäre jedes mehrseitige Dokument mit
Inhaltsverzeichnis nach dem Anhängen kaputt.

Der Unterschied zu einem Angriff liegt im Ziel, und das wird geprüft:

| Sprungtyp                                                 | Verhalten                              |
| --------------------------------------------------------- | -------------------------------------- |
| `/GoTo` auf eine importierte Seite                        | bleibt, umgebogen auf die neue Nummer  |
| `/GoTo` auf eine _nicht_ importierte Seite (`pages: [1]`) | verworfen                              |
| `/Dest (name)` benannte Destination                       | verworfen — Namensbaum kommt nicht mit |
| `/GoToR` in eine fremde Datei                             | verworfen                              |
| `/GoToE` in eine eingebettete Datei                       | verworfen                              |

Zum Selbsttest: dieselbe Datei mit `append(bytes, { pages: [1] })` anhängen.
Dann fehlt Seite 2, und der Sprung verschwindet — von vier bleiben drei
Annotationen.

---

## 7 · Zusammenfassung für die Akte

- Der Katalog der Quelle wird nie kopiert; dokumentweite Automatismen
  (`/OpenAction`, Skript-Namensbaum, `/AcroForm`, `/XFA`) existieren im Ergebnis
  nicht.
- Seiten werden aus einer **Whitelist von zehn Schlüsseln** neu aufgebaut;
  `/AA` ist nicht darunter.
- Annotationen sind auf **15 Markup-Typen** beschränkt; Payload-Träger wie
  `/Widget` und `/FileAttachment` fallen weg.
- Aktionen sind auf **Weblink** und **Sprung innerhalb der importierten Seiten**
  beschränkt; Weblinks laufen durch eine Schema-Sperre.
- Inhalt wird byteweise kopiert und nie ausgeführt oder dekodiert.
- Harte Grenzen gegen Bomben, Zyklen und Verschachtelung; verschlüsselte
  Quellen werden abgelehnt.
- Nachprüfbar mit einem Werkzeug, das fast-pdf nicht braucht:
  **25 riskante Fundstellen → 0**, bei erhaltener Kontrollgruppe.
- Upload-Größe und Seitenzahl bleiben Aufgabe der Anwendung — `pdfInfo()` ist
  dafür da.

Quellen im Repository: `src/pdf/reader.ts` (Parser), `src/pdf/import.ts`
(Whitelists, Aktionsprüfung), `src/validate.ts` (`blockedUriScheme`),
`tests/append.test.ts` (Regressionstests), `scripts/audit-pdf.mjs` (Audit),
`scripts/make-hostile-pdf.mjs` (Testdokument), [SECURITY.md](../SECURITY.md)
(Bedrohungsmodell, Meldeweg).
