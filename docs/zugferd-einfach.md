# ZUGFeRD in fast-pdf — einfach erklärt

Dieses Dokument erklärt in einfacher Sprache:

- Was ZUGFeRD ist.
- Was fast-pdf damit machen will.
- Warum wir es so machen.

Die genauen Details stehen in [`roadmap-1.0.md`](roadmap-1.0.md)
und in [`research/`](research/README.md).

---

## 1. Was ist ZUGFeRD?

Eine Rechnung kann man auf zwei Arten lesen:

- **Ein Mensch** liest sie. Er braucht ein schönes PDF.
- **Ein Computer** liest sie. Er braucht Daten in fester Form.
  Diese Form heißt **XML**.

ZUGFeRD verbindet beides in **einer** Datei:

> Ein ZUGFeRD-Dokument ist ein PDF.
> In diesem PDF steckt eine XML-Datei.

Der Mensch sieht das PDF.
Der Computer liest die XML-Datei darin.

**Factur-X** ist dasselbe. Das ist nur der französische Name.

---

## 2. Warum ist das gerade wichtig?

Ab dem **1. Januar 2027** gilt in Deutschland eine neue Regel:

Größere Firmen müssen Rechnungen an andere Firmen
**elektronisch** schicken.
Größer heißt: mehr als 800.000 € Umsatz im Vorjahr.

Viele Firmen wollen dafür ZUGFeRD benutzen.
Deshalb fragen viele Leute nach ZUGFeRD.

**Aber wichtig:**
Das Gesetz verlangt **kein** ZUGFeRD.
Eine reine XML-Datei reicht auch.
Diese heißt **XRechnung**.
Das hat das Finanzministerium klar gesagt.

Das heißt für uns:

- ZUGFeRD ist ein **Wunsch vom Markt**.
- ZUGFeRD ist **keine Pflicht** vom Gesetz.
- Niemand bekommt Ärger mit dem Finanzamt,
  nur weil fast-pdf noch kein ZUGFeRD kann.

---

## 3. Das Problem: PDF/A

ZUGFeRD verlangt eine besondere Art von PDF.
Diese Art heißt **PDF/A-3**.

Das „A" steht für **Archiv**.
Ein PDF/A muss man auch in 30 Jahren noch genau so öffnen können.
Dafür gibt es strenge Regeln.

fast-pdf hält diese Regeln heute **nicht** ein.
Hier die wichtigsten Gründe:

| Regel von PDF/A                                    | Was fast-pdf heute macht                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Alle Schriften müssen **in** der Datei stecken.    | fast-pdf benutzt normalerweise Helvetica. Diese Schrift steckt nicht darin. |
| Die Datei darf **nicht verschlüsselt** sein.       | fast-pdf kann Dateien mit einem Passwort schützen.                          |
| Die Farben brauchen eine **genaue Beschreibung**.  | fast-pdf schreibt diese Beschreibung nicht.                                 |
| Es müssen **Metadaten** in einer festen Form rein. | fast-pdf schreibt diese Metadaten nicht.                                    |
| Fremde PDF-Seiten können Regeln brechen.           | fast-pdf kann Seiten aus anderen PDFs anhängen. Die prüft es nicht genau.   |

Daraus folgt der wichtigste Satz:

> PDF/A ist kein kleines Extra.
> PDF/A ist ein **eigener Modus**.
> In diesem Modus muss fast-pdf manche Dinge **verbieten**.

Das ist viel Arbeit.
Wir schätzen **15 bis 28 Arbeitstage**.

---

## 4. Was wir deshalb machen

### Schritt 1: Version 1.0.0 kommt **ohne** ZUGFeRD

Version 1.0.0 ist ein Versprechen:

> „Ab jetzt bleibt die Schnittstelle stabil."

Dieses Versprechen soll **bald** kommen.
Es soll nicht auf ZUGFeRD warten.

Für 1.0.0 machen wir nur das Nötige:

- Die Doku muss die Wahrheit sagen.
- Automatische Tests laufen bei jeder Änderung (CI).
- Die öffentliche Schnittstelle ist aufgeräumt.

Das meiste davon ist schon fertig (Version 0.9.0).

### Schritt 2: Version 1.1.0 bringt ZUGFeRD

ZUGFeRD kommt in einen **eigenen Bereich**.
Man muss ihn extra laden:

```ts
import { ... } from "fast-pdf/zugferd";
```

Wer kein ZUGFeRD braucht, merkt davon **nichts**.
Das normale fast-pdf wird dadurch **kein Byte** größer.

---

## 5. Was fast-pdf bei ZUGFeRD macht — und was nicht

### fast-pdf macht: die Hülle

fast-pdf baut das **PDF/A-Dokument**.
Das ist wie ein Briefumschlag.
fast-pdf steckt die XML-Datei in diesen Umschlag.
fast-pdf prüft dabei ein paar einfache Dinge,
zum Beispiel:

- Hat die XML-Datei den richtigen Namen?
- Ist sie richtig aufgebaut?
- Passt die Angabe zum ZUGFeRD-Profil?

So soll es später ungefähr aussehen:

```ts
doc.attachFacturX(xml, { profile: "EN 16931" });
```

### fast-pdf macht **nicht**: den Inhalt der XML-Datei

Die XML-Datei bringt der Nutzer **selbst** mit.
fast-pdf schreibt sie nicht.

**Warum nicht?**

- Die XML-Regeln sind sehr groß.
  Es gibt fast 200 Geschäftsregeln und viele Code-Listen.
- Das wäre noch einmal **15 bis 30 Arbeitstage**.
- Die Regeln ändern sich oft.
  Das ist Steuer-Wissen, kein PDF-Wissen.
- Es gibt schon andere Programme, die diese XML-Dateien schreiben.

### Warum ist die Hülle trotzdem wertvoll?

Andere Programme machen es so:
Sie nehmen ein **fertiges** PDF und hängen die XML-Datei an.
Aber wenn das fertige PDF kein PDF/A ist,
können sie das **nicht mehr reparieren**.

fast-pdf baut das PDF **selbst**.
Es kann also von Anfang an ein richtiges PDF/A bauen.
Das können die anderen nicht.
**Genau diese Lücke will fast-pdf füllen.**

---

## 6. Was der Nutzer selbst tun muss

Wer ZUGFeRD mit fast-pdf machen will, muss **eine eigene Schrift** mitgeben.
Das ist eine Schrift-Datei im Format TTF, zum Beispiel eine freie Schrift.

```ts
doc.registerFont("Inter", schriftDatei);
```

**Warum liefert fast-pdf keine Schrift mit?**

Eine Schrift-Datei ist groß: 100 bis 300 KB.
fast-pdf selbst ist nur etwa 54 KB groß.
Die Schrift wäre also **viel größer** als das ganze Programm.
fast-pdf soll aber klein bleiben.

Wenn jemand die Schrift vergisst,
gibt fast-pdf eine **klare Fehlermeldung**.

**Die Farb-Beschreibung bringt fast-pdf dagegen mit.**
Die ist winzig: nur 456 Bytes.
Und sie ist frei nutzbar.

---

## 7. Welche ZUGFeRD-Variante?

ZUGFeRD hat mehrere **Profile**.
Ein Profil sagt, wie viele Daten in der XML-Datei stehen.

Wir fangen mit dem Profil **EN 16931** an.

**Warum?**
Die kleinen Profile (MINIMUM und BASIC-WL) zählen in Deutschland
**nicht** als echte E-Rechnung.
Das sagt das Finanzministerium ausdrücklich.

Bei PDF/A nehmen wir die Stufe **3b**.
Die strengere Stufe 3a bräuchte noch mehr Arbeit
(„Tagged PDF" für Barrierefreiheit). Das kann fast-pdf noch nicht.

---

## 8. Kurz zusammengefasst

1. **ZUGFeRD** = PDF für Menschen + XML für Computer in einer Datei.
2. ZUGFeRD ist **gewünscht**, aber **keine Pflicht** vom Gesetz.
3. ZUGFeRD braucht **PDF/A-3**. Das ist ein eigener, strenger Modus.
4. **1.0.0** kommt ohne ZUGFeRD. So kommt das Stabilitäts-Versprechen schnell.
5. **1.1.0** bringt ZUGFeRD in `fast-pdf/zugferd`.
6. fast-pdf baut **die Hülle**. Die XML-Datei bringt der Nutzer mit.
7. Der Nutzer gibt **eine eigene Schrift** mit. So bleibt fast-pdf klein.
