# Stichtage und Rechtspflichten — was wann gilt

> Recherchestand: **30.10.2026**. Nur das, was eine Priorisierungsentscheidung
> für fast-pdf beeinflusst. **Keine Steuer- und keine Rechtsberatung.**
> Siehe auch [`zugferd-container.md`](./zugferd-container.md).

## Frage

Welche Pflichten gelten ab wann — Deutschland B2B, EU ViDA, European
Accessibility Act / PDF/UA? Datiert, mit Quelle.

## Kurzantwort

Der harte, datierte Druck kommt aus Deutschland und ist **in 62 Tagen** da: ab
**01.01.2027** müssen inländische Unternehmer mit einem Vorjahresumsatz über
800 000 € ihre B2B-Rechnungen zwingend als E-Rechnung ausstellen
(§ 27 Abs. 38 Satz 1 Nr. 2 UStG). Die Übergangsfrist, die heute noch Papier und
reine PDFs erlaubt, endet am **31.12.2026**. Eine Verschiebung ist nicht
erkennbar. **Für fast-pdf ist aber eine Einschränkung entscheidend:** Die
rechtlich maßgeblichen Pflichtangaben liegen ausschließlich im strukturierten
XML-Teil, und das BMF stellt ausdrücklich klar, dass ein menschenlesbares
Dokument **gar nicht erforderlich** ist. ZUGFeRD/Factur-X ist damit eine
**Markt-, keine Rechtsanforderung** — eine reine XRechnung erfüllt das Gesetz
ebenso. PDF/UA hat dagegen **keinen einzigen Stichtag, der PDF/UA namentlich
fordert**: Das BFSG gilt zwar bereits seit 28.06.2025, nennt aber weder EN 301 549
noch PDF/UA; PDF/UA taucht nur in einer **informativen Anmerkung** von
EN 301 549 V4.1.1 auf, und das Dokument ist bislang nicht im EU-Amtsblatt unter
der Barrierefreiheitsrichtlinie zitiert. **Kurz: ZUGFeRD ist zeitkritisch
(Q4/2026), PDF/UA ist wichtig, aber ohne Deadline.**

---

## Übersichtstabelle

| Datum                   | Was gilt                                                                                                          | Für wen                                                            | Rechtsgrundlage (Fundstelle)                                                                            | Relevanz für fast-pdf                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 27.11.2018 / 27.11.2019 | B2G-Empfangspflicht Bund                                                                                          | Bundesbehörden                                                     | § 11 Abs. 1, 2 ERechV                                                                                   | gering (Empfängerseite)                                        |
| **27.11.2020**          | B2G: Lieferanten des Bundes **müssen** elektronisch stellen; Standard XRechnung                                   | Lieferanten des Bundes (> 1 000 € Direktauftrag)                   | § 3 Abs. 1 i. V. m. § 11 Abs. 3 ERechV; § 4 Abs. 1 ERechV                                               | mittel — reines XML, kein PDF                                  |
| **01.01.2025**          | **Empfangspflicht** für E-Rechnungen, ohne Übergangsregel                                                         | alle inländischen Unternehmer, auch Kleinunternehmer               | § 14 Abs. 2 S. 2 Nr. 1 UStG; BMF 15.10.2024 **Rn. 62**                                                  | gering (Lesen, nicht Schreiben)                                |
| **14.04.2025**          | Mitgliedstaaten dürfen nationale B2B-E-Rechnungspflichten **ohne Ratsermächtigung** einführen                     | EU-Mitgliedstaaten                                                 | RL (EU) 2025/516 Art. 1 Nr. 2, 3 (→ Art. 218 Abs. 2, Art. 232 Abs. 2 MwStSystRL); Art. 6 Abs. 1, Art. 7 | strategisch: weitere nationale Mandate werden wahrscheinlicher |
| **28.06.2025**          | BFSG gilt; Verbraucherdienstleistungen müssen barrierefrei sein                                                   | E-Commerce, Bankdienstleistungen, E-Books, TK, Personenbeförderung | § 1 Abs. 3 Nr. 3–5 BFSG; § 22 BFSGV                                                                     | **PDF/UA-relevant, bereits scharf**                            |
| **01.09.2026**          | FR: Empfangspflicht alle; Ausstellungspflicht Großunternehmen/ETI                                                 | Frankreich                                                         | Art. 91 Loi n° 2023-1322 (LF 2024); Ordonnance n° 2021-1190                                             | **Factur-X-Nachfrage ist jetzt live**                          |
| **31.12.2026**          | Letzter Tag, an dem Papier/PDF für 2025–2026-Umsätze zulässig ist                                                 | alle                                                               | § 27 Abs. 38 S. 1 **Nr. 1** UStG; BMF 15.10.2024 **Rn. 63**                                             | **kritisch**                                                   |
| **01.01.2027**          | **Ausstellungspflicht E-Rechnung** bei Vorjahresumsatz > 800 000 €                                                | inländische B2B-Umsätze                                            | § 14 Abs. 2 S. 2 Nr. 1 i. V. m. § 27 Abs. 38 S. 1 Nr. 2 UStG                                            | **höchste Priorität**                                          |
| **01.09.2027**          | FR: Ausstellungspflicht PME/TPE/Mikro                                                                             | Frankreich                                                         | s. o.                                                                                                   | Factur-X in der Breite                                         |
| **31.12.2027**          | Ende Übergang für ≤ 800 000 € **und** Ende EDI-Übergang                                                           | kleinere Unternehmen / EDI-Nutzer                                  | § 27 Abs. 38 S. 1 **Nr. 2 und Nr. 3** UStG; BMF 15.10.2024 **Rn. 64, 65**                               | hoch                                                           |
| **01.01.2028**          | E-Rechnungspflicht faktisch für alle inländischen B2B-Umsätze                                                     | alle (außer Kleinunternehmer, ≤ 250 €, Fahrausweise)               | § 14 Abs. 2 S. 2 Nr. 1 UStG (Übergang ausgelaufen)                                                      | hoch                                                           |
| **27.06.2030**          | Ende Bestandsschutz für vor dem 28.06.2025 eingesetzte Produkte                                                   | Dienstleister nach BFSG                                            | § 38 BFSG                                                                                               | PDF/UA mittelfristig                                           |
| **01.07.2030**          | EU: E-Rechnung ist **Standard**; 10-Tage-Frist; Digital Reporting Requirements für innergemeinschaftliche Umsätze | EU-weit, grenzüberschreitend B2B                                   | RL (EU) 2025/516 Art. 5 (→ Art. 217, 218, 222, 262–264 MwStSystRL); Art. 6 Abs. 5                       | mittel (Fernziel)                                              |
| **01.01.2035**          | Konvergenz nationaler Altsysteme (DE, FR, IT, PL …) auf den EU-Standard                                           | Mitgliedstaaten mit Altsystemen                                    | RL (EU) 2025/516 Art. 6 Abs. 5 UAbs. 2                                                                  | niedrig                                                        |

---

## 1. Deutschland — E-Rechnungspflicht B2B

### 1.1 Gesetz

**Wachstumschancengesetz vom 27.03.2024**, Artikel 23 — Neufassung des § 14 UStG.
Das Datum ist primärquellenbelegt über die Anwendungsvorschrift § 27 Abs. 39 UStG
(„in der Fassung … vom 27. März 2024"). Die BGBl.-Fundstelle **BGBl. 2024 I Nr. 108**
stammt aus übereinstimmenden Sekundärquellen — siehe „Nicht abschließend belegt".
<https://www.gesetze-im-internet.de/ustg_1980/__27.html>

### 1.2 Der Begriff der E-Rechnung — der entscheidende Punkt für eine PDF-Library

**§ 14 Abs. 1 Satz 3 und Satz 6 UStG:** Eine E-Rechnung muss „in einem
strukturierten elektronischen Format ausgestellt, übermittelt und empfangen"
werden, das eine elektronische Verarbeitung ermöglicht, und entweder

1. der europäischen Norm für die elektronische Rechnungsstellung und der
   Syntaxliste gemäß **Richtlinie 2014/55/EU** entsprechen, oder
2. zwischen den Parteien vereinbart sein, sofern die Pflichtangaben vollständig
   und richtig in ein EN-konformes oder interoperables Format extrahiert werden
   können.

Alles andere ist „sonstige Rechnung" (§ 14 Abs. 1 Satz 4 UStG). Der UStAE in der
Fassung des BMF-Schreibens vom 15.10.2025 formuliert es wörtlich — **eigene
Verifikation am PDF-Volltext**:

> „Dazu zählen auch alle nicht strukturierten elektronischen Dateien, zum
> Beispiel **PDF-Dateien ohne integrierte Datensätze**, Bilddateien oder Angaben
> in E-Mails."
> — UStAE **Abschnitt 14.1 Abs. 3 Satz 4 Nr. 2**, i. d. F. BMF v. 15.10.2025

**Ein von fast-pdf erzeugtes PDF ist damit per se keine E-Rechnung.** Es wird
erst eine, wenn ein konformer strukturierter Datensatz eingebettet ist.

### 1.3 Die gestaffelten Stichtage (§ 27 Abs. 38 UStG, wörtlich geprüft)

| Norm                        | Inhalt                                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empfang**                 | Keine Übergangsregelung. Zu gewährleisten **seit 01.01.2025**. BMF 15.10.2024 **Rn. 62**: „Hinsichtlich des Empfangs einer E-Rechnung gilt keine Übergangsregelung, er ist somit vom 1. Januar 2025 an durch den Rechnungsempfänger zu gewährleisten."         |
| **§ 27 Abs. 38 S. 1 Nr. 1** | Für Umsätze nach dem 31.12.2024 und vor dem 01.01.2027: sonstige Rechnung (Papier; mit Zustimmung ein anderes elektronisches Format) zulässig **bis 31.12.2026**. BMF 15.10.2024 **Rn. 63**.                                                                   |
| **§ 27 Abs. 38 S. 1 Nr. 2** | Für Umsätze nach dem 31.12.2026 und vor dem 01.01.2028: sonstige Rechnung zulässig **bis 31.12.2027**, **nur wenn** der Gesamtumsatz i. S. d. § 19 Abs. 2 UStG im **vorangegangenen Kalenderjahr nicht mehr als 800 000 €** betrug. BMF 15.10.2024 **Rn. 64**. |
| **§ 27 Abs. 38 S. 1 Nr. 3** | **EDI-Übergang** bis **31.12.2027** (Empfehlung 94/820/EG, mit Zustimmung des Empfängers). BMF 15.10.2024 **Rn. 65**.                                                                                                                                          |

### 1.4 Status am 30.10.2026

- **Gilt heute:** Empfangspflicht (seit 01.01.2025). Ausstellungsseitig läuft
  noch § 27 Abs. 38 S. 1 Nr. 1 — Papier und PDF sind für Umsätze bis 31.12.2026
  **noch zulässig**, Papier sogar ohne Zustimmung.
- **Kommt noch:** 01.01.2027 (> 800 000 € Vorjahresumsatz 2026),
  31.12.2027 (Ende Nr. 2 und Nr. 3), 01.01.2028 (alle).
- **Jahresübergangsfalle:** Maßgeblich ist der **Zeitpunkt des Umsatzes**, nicht
  der Rechnungsstellung. Eine im Januar 2027 gestellte Rechnung über einen
  Dezember-2026-Umsatz fällt noch unter Nr. 1.
- **Verschiebung?** Nicht erkennbar. Das **Jahressteuergesetz 2026**
  (Kabinett 12.08.2026; BT-Drs. **21/8283** vom 30.09.2026; erste Lesung
  **08.10.2026**) enthält nach der auffindbaren Berichterstattung keine Änderung
  an § 27 Abs. 38 UStG. Der ZDH hatte im Juni 2026 eine Verschiebung auf 2028
  gefordert — ohne Gesetzgebungsverfahren.
  <https://www.bundestag.de/dokumente/textarchiv/2026/kw41-de-jahressteuergesetz-2026-1217566>

### 1.5 BMF-Schreiben — ZUGFeRD/Factur-X, mit Randziffern

**Schreiben I: BMF vom 15.10.2024**, GZ `III C 2 - S 7287-a/23/10001 :007`,
DOK `2024/0883282`, BStBl I S. 1320.

| Rn.       | Inhalt                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **25**    | XRechnung und ZUGFeRD: „Rechnungen in diesen beiden Formaten können nach dem 31. Dezember 2024 die neuen umsatzsteuerlichen Anforderungen für eine E-Rechnung erfüllen."                                                                                                                                                                                                        |
| **26**    | „Beispiele für zulässige europäische elektronische Rechnungsformate … z. B. **Factur-X (Frankreich)** oder **Peppol-BIS Billing**."                                                                                                                                                                                                                                             |
| **28**    | EN 16931 als technische Umsetzung der RL 2014/55/EU durch CEN.                                                                                                                                                                                                                                                                                                                  |
| **29**    | XRechnung entspricht EN 16931 und § 14 Abs. 1 Satz 6 Nr. 1 UStG; die Extension XRechnung ist „conformant".                                                                                                                                                                                                                                                                      |
| **30**    | **Die Kernstelle:** „Beispielsweise fällt das Format ZUGFeRD unter die hybriden Rechnungsformate. … ist dies **ab der Version 2.0.1 — ausgenommen die Profile MINIMUM und BASIC-WL** — der Fall, weshalb eine ZUGFeRD-Rechnung ab dieser Version die Anforderungen an eine E-Rechnung erfüllt."                                                                                 |
| **31**    | „Bei einem hybriden Format bilden die im XML-Format vorliegenden Rechnungsdaten den **führenden Teil**."                                                                                                                                                                                                                                                                        |
| **32**    | Abweichender Bildteil kann eine weitere (sonstige) Rechnung sein → § 14c UStG. „Ein **Vorsteuerabzug ist auch in diesen Fällen nur aus dem strukturierten Rechnungsteil** möglich."                                                                                                                                                                                             |
| **35**    | „Alle umsatzsteuerrechtlichen Pflichtangaben nach §§ 14, 14a UStG müssen **im strukturierten Teil** der E-Rechnung enthalten sein." Ergänzende Angaben dürfen in einem **in der E-Rechnung enthaltenen Anhang** stehen (z. B. Stundennachweise als PDF). „Ein enthaltener Link erfüllt weder die Voraussetzungen nach § 14 Absatz 1 Satz 3 UStG noch nach § 31 Absatz 1 UStDV." |
| **62–65** | Übergangsregelungen (s. o.).                                                                                                                                                                                                                                                                                                                                                    |
| **67**    | Anwendung auf alle Umsätze, die nach dem 31.12.2024 ausgeführt werden.                                                                                                                                                                                                                                                                                                          |

**Schreiben II: BMF vom 15.10.2025**, GZ `III C 2 - S 7287-a/00019/007/243`,
DOK `COO.7005.100.4.13163130`, 33 Seiten. Es ändert einzelne Randziffern des
2024er-Schreibens **und** überführt die Grundsätze in den UStAE.
<https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf>

| UStAE-Fundstelle                                | Inhalt                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Abschn. 14.1 Abs. 3 Satz 4 Nr. 2**            | „PDF-Dateien ohne integrierte Datensätze" = sonstige Rechnung. _(eigene Verifikation am PDF-Volltext)_                                                                                                                                                                                                                               |
| **Abschn. 14.1 Abs. 14 Satz 4**                 | „⁴Beispielsweise das hybride Format **ZUGFeRD ab der Version 2.0.1 — ausgenommen die Profile MINIMUM und BASIC-WL** — beruht auf der Normenreihe EN 16931 und fällt somit unter die zulässigen E-Rechnungs-Formate." _(eigene Verifikation)_                                                                                         |
| **Abschn. 14.4 Abs. 3**                         | „³Die zusätzliche Erstellung eines menschenlesbaren Dokuments ist **nicht erforderlich**." Und: „⁵Bei einem hybriden Format bilden die im strukturierten Teil vorliegenden Rechnungsdaten den führenden Teil. ⁶Im Fall von Abweichungen … gehen die Daten des strukturierten Teils denen der Bilddatei vor." _(eigene Verifikation)_ |
| **Abschn. 14.5 Abs. 1 Sätze 4 ff.** (neu)       | Alle Pflichtangaben müssen im strukturierten Teil enthalten sein.                                                                                                                                                                                                                                                                    |
| **Abschn. 14c.1 Abs. 4a** (neu)                 | Bildteil ohne abweichende Angaben = „inhaltlich identisches Mehrstück"; Vorsteuerabzug nur aus dem strukturierten Teil.                                                                                                                                                                                                              |
| **Rn. 6a / 6b** (Änderung zum 2024er-Schreiben) | **Formatfehler** (Verletzung von Format- oder Geschäftsregeln) führen dazu, dass die Datei die Anforderungen an eine E-Rechnung **nicht** erfüllt und nur eine sonstige Rechnung ist. **Inhaltsfehler** (Rn. 35a) führen zu einer nicht ordnungsmäßigen Rechnung.                                                                    |

> **Rn. 6a/6b ist die Stelle, an der Recht und CI sich berühren.** Eine
> schematisch ungültige ZUGFeRD-Datei ist rechtlich wertlos. Validierung ist
> damit kein Qualitätsbonus, sondern Teil des Features — siehe
> [`validatoren-ci.md`](./validatoren-ci.md).

### 1.6 Kleinunternehmer und Kleinbetragsrechnungen

- **Kleinbetragsrechnungen bis 250 € brutto** und **Fahrausweise**: können
  **immer** als sonstige Rechnung ausgestellt werden — § 33 Satz 4 UStDV,
  § 34 Abs. 1 Satz 2 UStDV. BMF 15.10.2024 **Rn. 22, 23**.
- **Kleinunternehmer (§ 19 UStG)**: durch **§ 34a Satz 4 UStDV** von der
  **Ausstellungs**pflicht befreit. Bestätigt im Schreiben vom 15.10.2025,
  **UStAE Abschn. 14.7a Abs. 3** (neu): „Rechnungen von Kleinunternehmern können
  immer entweder als Rechnung in Papierform oder mit Zustimmung des Empfängers
  in einem anderen elektronischen Format ausgestellt und übermittelt werden."
  _(eigene Verifikation am PDF-Volltext)_
  Die **Empfangs**pflicht gilt auch für sie (BMF 15.10.2024 Rn. 62).

**Relevanz für fast-pdf:** Die größte verbleibende Nutzergruppe für rein visuelle
PDF-Rechnungen sind Kleinunternehmer, Kleinbeträge ≤ 250 €, B2C-Rechnungen und
steuerfreie Umsätze nach § 4 Nr. 8–29 UStG. **Das Produkt wird nicht obsolet** —
aber jeder gewerbliche B2B-Anwender oberhalb der Schwelle braucht ab 01.01.2027
mehr als ein PDF.

---

## 2. Deutschland — B2G

**E-Rechnungsverordnung (ERechV) vom 13.10.2017, BGBl. I S. 3555**, zuletzt
geändert durch Art. 76 der V v. 19.06.2020 (BGBl. I S. 1328).
<https://www.gesetze-im-internet.de/erechv/BJNR355500017.html>

- **§ 3 Abs. 1:** Rechnungssteller **müssen** elektronisch ausstellen und
  übermitteln. Ausnahmen: Direktaufträge **bis 1 000 €**, §§ 8, 9 ERechV,
  Organleihe.
- **§ 4 Abs. 1:** Grundsätzlich **XRechnung**. Ein **anderer Standard ist
  zulässig, wenn er die europäische Norm erfüllt** — das ist die Tür, durch die
  ZUGFeRD ab 2.0.1 (ohne MINIMUM/BASIC-WL) auch im B2G passt.
- **§ 11:** Abs. 1 → 27.11.2018; Abs. 2 (subzentrale Auftraggeber) → 27.11.2019;
  Abs. 3: „§ 3 Absatz 1 tritt am **27. November 2020** in Kraft."
- Übermittlungskanäle Bund: Weberfassung, Upload, **Peppol**, E-Mail; zusätzlich
  OZG-RE. <https://www.e-rechnung-bund.de/e-rechnung/>

**Länder** regeln eigenständig und uneinheitlich (Bremen seit 27.11.2020;
BW, Saarland, RP seit 01.01.2022; MV seit 01.04.2023; Bayern ohne generelle
Lieferantenpflicht). Diese Angaben stammen **ausschließlich aus Sekundärquellen**
und wurden nicht an Landesverordnungen verifiziert.

**Relevanz für fast-pdf:** B2G ist XML-first. Ein PDF-Generator spielt hier
praktisch keine Rolle.

---

## 3. EU — ViDA

**Richtlinie (EU) 2025/516 des Rates vom 11. März 2025** zur Änderung der
Richtlinie 2006/112/EG in Bezug auf die Mehrwertsteuervorschriften für das
digitale Zeitalter. **ABl. L 2025/516 vom 25.03.2025**.
<https://eur-lex.europa.eu/eli/dir/2025/516/oj/deu>

**Status: angenommen und in Kraft.** Inkrafttreten nach Art. 7 am zwanzigsten Tag
nach Veröffentlichung → **14.04.2025**.

### 3.1 Nationale B2B-Pflichten ohne Ratsermächtigung — seit 14.04.2025

- **Art. 1 Nr. 2** → neuer **Art. 218 Abs. 2 MwStSystRL**: „Abweichend von
  Absatz 1 dieses Artikels können die Mitgliedstaaten … verlangen, dass in ihrem
  Gebiet ansässige Steuerpflichtige für andere als die in Artikel 262 genannten
  Lieferungen … elektronische Rechnungen ausstellen."
- **Art. 1 Nr. 3** → neuer **Art. 232 Abs. 2 MwStSystRL**: Zustimmung des
  Empfängers ist dann nicht erforderlich.
- **Art. 6 Abs. 1:** anwendbar **ab 14.04.2025**.

→ Die frühere Hürde (Art.-395-Ratsermächtigung, wie sie Deutschland am
25.07.2023 brauchte) ist entfallen. Weitere nationale Mandate sind damit
deutlich wahrscheinlicher.

### 3.2 Stichtage

| Artikel RL 2025/516   | Umsetzung bis  | Anwendung ab   | Inhalt                                                                       |
| --------------------- | -------------- | -------------- | ---------------------------------------------------------------------------- |
| Art. 2                | 31.12.2026     | **01.01.2027** | Anpassungen OSS/IOSS                                                         |
| Art. 3                | 30.06.2028     | **01.07.2028** | Plattformregelungen, „fiktiver Lieferer"; Ende Konsignationslager 30.06.2028 |
| Art. 4                | 30.06.2029     | **01.07.2029** | Streichung Art. 243 Abs. 3, Art. 262 Abs. 2                                  |
| **Art. 5**            | **30.06.2030** | **01.07.2030** | **E-Rechnung als Default + Digital Reporting Requirements**                  |
| Art. 6 Abs. 5 UAbs. 2 | —              | **01.01.2035** | Mitgliedstaaten mit bestehender oder vor 2024 vorbereiteter Meldepflicht     |

### 3.3 Was ab 01.07.2030 gilt (Art. 5)

- **Art. 217 n. F.:** Elektronische Rechnung = in einem **strukturierten
  elektronischen Format** ausgestellt, übermittelt und empfangen, das eine
  automatische Verarbeitung ermöglicht.
- **Art. 218 n. F.:** Rechnungen gelten grundsätzlich als elektronisch
  ausgestellt. Papier nur bei Umsätzen **ohne** Meldepflicht und nur, soweit der
  Mitgliedstaat es zulässt. → **Umkehr des Regel-Ausnahme-Verhältnisses.**
- **Art. 218 Abs. 3 n. F.:** Verweis auf die „europäische Norm für die
  elektronische Rechnungsstellung" und die Syntaxliste nach RL 2014/55/EU.
  **„EN 16931" wird im Richtlinientext nicht wörtlich genannt** — der Verweis
  erfolgt funktional; EN 16931 ist deren technische Umsetzung (so auch BMF
  15.10.2024 Rn. 28).
- **Rechnungsfrist:** spätestens **zehn Tage** nach Eintritt des
  Steuertatbestands.
- **DRR (Art. 262–264 n. F.):** Transaktionsbezogene Meldung grenzüberschreitender
  B2B-Umsätze. Art. 265–271 werden aufgehoben.
- **Art. 271c:** Kommissions-Zwischenbericht bis 31.03.2033.

**Relevanz für fast-pdf:** ViDA ist kein kurzfristiger Treiber, bestätigt aber
die Richtung: strukturiertes XML wird europaweit Standard, PDF wird zum
optionalen Visualisierungsbeiwerk. Kein Grund, ZUGFeRD-Arbeit zu beschleunigen
oder zu verzögern — aber ein Argument dafür, EN-16931-Arbeit nicht als deutsche
Sonderlocke zu behandeln.

---

## 4. European Accessibility Act / PDF/UA

### 4.1 Rechtsrahmen

- **Richtlinie (EU) 2019/882** vom 17.04.2019.
- **Barrierefreiheitsstärkungsgesetz (BFSG) vom 16.07.2021, BGBl. I S. 2970
  (Nr. 46)**, zuletzt geändert durch Art. 32 des G. v. 06.05.2024,
  BGBl. 2024 I Nr. 149. **Geltungsbeginn 28.06.2025.**
  <https://www.gesetze-im-internet.de/bfsg/BJNR297010021.html>
- **BFSGV vom 15.06.2022, BGBl. I S. 928**, zuletzt geändert durch Art. 1 der
  V v. 10.07.2026, BGBl. 2026 I Nr. 205 (ab 16.07.2026; betrifft § 7 und § 14
  BFSGV, also Produkte/Telekommunikation — **nicht** die Dokumentanforderungen).
  Inkrafttreten: 28.06.2025 (§ 22).
  <https://www.gesetze-im-internet.de/bfsgv/BJNR092800022.html>

### 4.2 Betrifft es PDFs — und Rechnungs-PDFs?

**Anwendungsbereich (§ 1 Abs. 3 BFSG)** — Dienstleistungen, die **für Verbraucher
nach dem 28.06.2025** erbracht werden: Telekommunikationsdienste · bestimmte
Elemente von Personenbeförderungsdiensten · **Bankdienstleistungen für
Verbraucher** · **E-Books und hierfür bestimmte Software** · **Dienstleistungen
im elektronischen Geschäftsverkehr**.

**§ 2 Nr. 26 BFSG** definiert Letztere als digitale Dienste, die elektronisch auf
individuelle Anfrage eines Verbrauchers im Hinblick auf einen **Verbrauchervertrag**
erbracht werden. → **B2C, nicht B2B.**

**Der PDF-Anknüpfungspunkt liegt in § 12 BFSGV:** Der Informationsinhalt ist
„**in Textformaten zur Verfügung** [zu] stellen, die sich **zum Generieren
alternativer assistiver Formate** durch den Verbraucher eignen" (Umsetzung von
EAA Anhang I Abschnitt III Buchst. b Ziff. iv).

**§ 19 BFSGV** (elektronischer Geschäftsverkehr) fordert ausdrücklich nur:
Informationen zur Barrierefreiheit der verkauften Produkte/Dienstleistungen sowie
wahrnehmbare/bedienbare/verständliche/robuste Identifizierungs-,
Authentifizierungs-, Signatur- und Zahlungsfunktionen. **Der Begriff „Dokument"
kommt in §§ 17–19 BFSGV nicht vor.**

**Rechnungs-PDFs sind damit nicht ausdrücklich geregelt.** Die herrschende
Beratungspraxis leitet die Erfassung über § 12 BFSGV ab. **Das ist eine
vertretbare Auslegung, aber keine ausdrückliche gesetzliche Anordnung** — siehe
„Nicht abschließend belegt".

EN 301 549 stützt die Auslegung: Tabelle **ZB.4 Nr. 8** mappt EAA Anhang I
Abschnitt III Buchst. b Ziff. vii auf „4.2, 12.2, provides a link to the
applicability of clause 9 (for web), **clause 10 (for docs)**, & clause 11 (for
software)"; Tabelle **ZB.4 Nr. 5** mappt Ziff. iv u. a. auf **10.1.1**.

### 4.3 EN 301 549 — Fassung und Aussage zu PDF

Geprüft am ETSI-Primärdokument: **EN 301 549 V4.1.1 (2026-09)**.
<https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf>

- Erarbeitet unter Normungsauftrag **M/587** (C(2022)6456 final vom 14.09.2022)
  **zur Unterstützung der Richtlinie (EU) 2019/882**; Annex ZB bildet die
  EAA-Mindestanforderungen ab.
- Wesentliche Änderung gegenüber V3.2.1 (03-2021): Bezug auf **WCAG 2.2** statt
  2.1; getrennte Anforderungen für Webseiten (Clause 9), **Non-web documents
  (Clause 10)** und Non-web software (Clause 11); neuer Abschnitt 10.7.
- **Clause 10 = „Non-web documents"**: jedes Kriterium fordert Erfüllung des
  entsprechenden WCAG-2.2-Erfolgskriteriums, z. B. 10.1.1.1 für SC 1.1.1
  Non-text content.
- **Clause 10.0 NOTE 8:** Die Anforderungen gelten auch für Dokumente, die durch
  digitale Signaturen, Verschlüsselung, Passwortschutz oder Wasserzeichen
  geschützt sind.
- **Clause 10.0 NOTE 11 — die einzige PDF/UA-Erwähnung, wörtlich:**

  > „ISO 14289-1:2014 [i.71] and ISO 14289-2:2024 [i.72] are the technical
  > standards for accessible PDFs and **would be useful in meeting** EN 301 549."

  Das ist eine **informative NOTE**, keine normative Anforderung. **PDF/UA ist
  nicht vorgeschrieben, sondern empfohlen.**

- **„Void"-Kriterien** für Einzeldokumente: 10.2.4.1, 10.2.4.5, 10.3.2.3, 10.3.2.4.
- **Vermutungswirkung:** Laut Foreword tritt sie erst ein, „once the present
  document is cited in the Official Journal of the European Union under that
  Directive". Nach den auffindbaren Quellen ist **V4.1.1 bis heute (30.10.2026)
  nicht im Amtsblatt unter der RL 2019/882 zitiert**.

**Wichtig:** Die **BFSGV nennt weder EN 301 549 noch WCAG noch PDF/UA.**
§ 3 BFSGV fordert lediglich, dass „der **Stand der Technik** zu beachten" ist.

### 4.4 Ausnahmen

- **§ 3 Abs. 3 BFSG:** gilt **nicht für Kleinstunternehmen, die
  Dienstleistungen anbieten oder erbringen**.
- **§ 2 Nr. 17 BFSG:** Kleinstunternehmen = weniger als **zehn** Beschäftigte
  **und** höchstens **2 Mio. €** Jahresumsatz **oder** Jahresbilanzsumme.
- **§ 16 BFSG:** keine Pflicht bei **grundlegender Veränderung** von
  Produkt/Dienstleistung.
- **§ 17 Abs. 1 BFSG:** keine Pflicht bei **unverhältnismäßiger Belastung nach
  Anlage 4**; Selbstbeurteilung, dokumentationspflichtig.
- **§ 38 BFSG:** Bestandsschutz für vor dem 28.06.2025 eingesetzte Produkte
  **bis 27.06.2030**.
- **§ 37 BFSG:** Bußgelder bis **100 000 €**.

### 4.5 Was heißt das für einen PDF-Generator?

1. **Kein datierter Stichtag, der PDF/UA fordert.** Die Pflicht ist seit
   28.06.2025 bereits scharf — es gibt also nichts mehr abzuwarten, aber auch
   keinen Countdown, der die Priorisierung erzwingt.
2. **PDF/UA ist rechtlich nicht vorgeschrieben**, sondern der normierte Weg. Für
   § 12 BFSGV („Textformate, die sich zum Generieren alternativer assistiver
   Formate eignen") ist Tagged PDF mit Strukturbaum, Leseordnung,
   Textalternativen, Sprach-Tagging und Dokumenttitel aber **faktisch
   alternativlos** — ein untagged PDF kann das definitionsgemäß nicht.
3. **Betroffen sind nur B2C-Dienstleistungen.** **B2B-Rechnungs-PDFs fallen
   nicht unter das BFSG.** Das ist der wichtigste Priorisierungsfilter: die
   Schnittmenge zwischen „BFSG-pflichtig" und „typischer fast-pdf-Anwendungsfall
   Rechnung" ist schmal.
4. **E-Books (§ 18 BFSGV)** sind der schärfste Fall: Dateien dürfen „die
   ordnungsgemäße Funktionsweise assistiver Technologien nicht verhindern";
   gefordert sind Zugang zu Inhalt/Navigation/Struktur, flexible Darstellung und
   **Barrierefreiheitsmetadaten**.
5. **Trigger für eine Neubewertung:** Zitierung von EN 301 549 V4.1.1 im
   EU-Amtsblatt unter der RL 2019/882 (erwartet Q4/2026). Ab dann gibt es eine
   Vermutungswirkung und eine zitierbare Zielnorm.

> **Technischer Anschluss:** fast-pdf schreibt bereits `/Lang` am Katalog
> (`src/document/document.ts:3199`) und `ViewerPreferences /DisplayDocTitle`
> (Z. 3201) — beides sind PDF/UA-Bausteine. Was fehlt, ist `/MarkInfo`,
> `/StructTreeRoot` und die gesamte Tagging-Schicht. Siehe
> [`pdfa3b-anforderungen.md`](./pdfa3b-anforderungen.md), Abschnitt „Was
> PDF/A-3b _nicht_ verlangt".

---

## 5. Frankreich

Rechtsgrundlagen: Ordonnance n° 2021-1190; **Art. 91 der Loi n° 2023-1322
(Loi de finances pour 2024)**; Art. 62 der Loi n° 2022-1726; Décret n° 2022-1299.
<https://entreprendre.service-public.gouv.fr/actualites/A15683> (Stand der
Seite: 27.02.2026)

| Pflicht                                      | Grandes entreprises & ETI | PME, TPE, micro-entreprises       |
| -------------------------------------------- | ------------------------- | --------------------------------- |
| **Empfang**                                  | **01.09.2026**            | **01.09.2026** (alle Unternehmen) |
| **Ausstellung**                              | **01.09.2026**            | **01.09.2027**                    |
| Neue Pflichtangaben (z. B. SIREN des Kunden) | 01.09.2026                | 01.09.2027                        |

- Derselbe Zeitplan gilt für das **e-reporting**.
- Rechnungen müssen über eine **zugelassene Plattform (PDP)** laufen.
- **Status am 30.10.2026: die erste Stufe ist seit knapp zwei Monaten live.**
  Die offizielle Seite nennt keinen Aufschub.
- **Factur-X** ist das französische Pendant zu ZUGFeRD; beide werden gemeinsam
  von **FeRD** (DE) und **FNFE-MPE** (FR) gepflegt. Das BMF nennt Factur-X
  ausdrücklich als zulässiges Format (BMF 15.10.2024 Rn. 26).

**Relevanz für fast-pdf:** Frankreich ist **der** Markttreiber für Factur-X — die
Empfangspflicht ist bereits in Kraft, die Ausstellungspflicht für den Mittelstand
folgt in zehn Monaten. Da ZUGFeRD und Factur-X **dasselbe Format** sind,
erschließt eine einzige Implementierung beide Märkte.

---

## Nicht abschließend belegt

1. **BGBl.-Fundstelle des Wachstumschancengesetzes** („BGBl. 2024 I Nr. 108"):
   nur aus Sekundärquellen; das Datum 27.03.2024 ist über § 27 Abs. 39 UStG
   primärbelegt.
2. **BStBl-Seitenzahl des BMF-Schreibens vom 15.10.2025** („BStBl 2025 I S. 1806"):
   Sekundärquelle. Datum, GZ und DOK sind aus dem BMF-PDF primärbelegt.
3. **Volltext der RL (EU) 2025/516:** EUR-Lex lieferte keinen maschinell
   abrufbaren Inhalt (HTTP 202, leerer Body). Der Text wurde über einen
   Volltext-Spiegel gelesen; die Artikelnummerierung wurde **nicht** gegen
   EUR-Lex gegengeprüft.
4. **Verordnung (EU) 2025/517 und Durchführungsverordnung (EU) 2025/518** (die
   Begleitrechtsakte des ViDA-Pakets) wurden **nicht** geprüft.
5. **Inkrafttretensdatum 14.04.2025:** errechnet aus Art. 7; nicht amtlich
   verifiziert.
6. **Zitierung von EN 301 549 V4.1.1 im EU-Amtsblatt:** bis heute nicht
   auffindbar. Ein negativer Nachweis ist nicht zu führen; die kursierenden
   Erwartungsdaten (30.11.2026, 16.12.2026) stammen aus Dienstleister-Blogs und
   widersprechen sich.
7. **Ob Rechnungs-PDFs unter das BFSG fallen:** BFSG und BFSGV regeln es
   **nicht ausdrücklich**; die Erfassung wird über § 12 BFSGV und EN 301 549
   Tabelle ZB.4 Nr. 8 abgeleitet. Behördliche oder gerichtliche Bestätigung
   wurde nicht gefunden. Einzelne Quellen nennen abweichend den 29.06.2025 als
   ersten Geltungstag.
8. **B2G-Landesrecht:** alle Länder-Stichtage aus Sekundärquellen, teils
   widersprüchlich.
9. **Frankreich:** Die „formats socles" (Factur-X, UBL, CII) stehen nicht auf der
   service-public-Seite, sondern in den DGFiP-Spezifikationen, die nicht
   abgerufen wurden. Dass eine Verschiebung auf 2028 endgültig vom Tisch ist,
   ist nicht durch einen amtlichen Text belegt.
10. **Jahressteuergesetz 2026:** Der Volltext der BT-Drs. 21/8283 wurde **nicht**
    gelesen. Eine Änderung im Ausschussverfahren nach dem 08.10.2026 kann nicht
    ausgeschlossen werden. **Das ist der eine Punkt, der vor einer endgültigen
    Roadmap-Entscheidung noch primär geprüft werden sollte.**

## Quellen

**Gesetze und Verordnungen**

- § 14 UStG — <https://www.gesetze-im-internet.de/ustg_1980/__14.html>
- § 27 UStG (Abs. 38) — <https://www.gesetze-im-internet.de/ustg_1980/__27.html>
- ERechV — <https://www.gesetze-im-internet.de/erechv/BJNR355500017.html>
- BFSG — <https://www.gesetze-im-internet.de/bfsg/BJNR297010021.html> · <https://www.buzer.de/BFSG.htm>
- BFSGV — <https://www.gesetze-im-internet.de/bfsgv/BJNR092800022.html>

**Verwaltungsanweisungen**

- BMF 15.10.2024, GZ III C 2 - S 7287-a/23/10001 :007 — <https://www.ihk.de/blueprint/servlet/resource/blob/6375824/e77a84c311d8338f6b5f3d578059ea56/bmf-schreiben-vom-15-10-2024-erechnung-data.pdf>
- BMF 15.10.2025, GZ III C 2 - S 7287-a/00019/007/243 — <https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf> _(Volltext eigenständig extrahiert und geprüft)_

**EU**

- RL (EU) 2025/516 (ViDA) — <https://eur-lex.europa.eu/eli/dir/2025/516/oj/deu>
- EN 301 549 V4.1.1 (2026-09), ETSI — <https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf>

**Gesetzgebung / Verwaltung**

- E-Rechnung Bund — <https://www.e-rechnung-bund.de/e-rechnung/>
- BT-Drs. 21/8283 (30.09.2026) — <https://dserver.bundestag.de/btd/21/082/2108283.pdf>
- Bundestag, erste Lesung JStG 2026 (08.10.2026) — <https://www.bundestag.de/dokumente/textarchiv/2026/kw41-de-jahressteuergesetz-2026-1217566>

**Frankreich**

- service-public.gouv.fr, Facturation électronique — <https://entreprendre.service-public.gouv.fr/actualites/A15683>

**Format**

- FeRD, ZUGFeRD 2.5.2 — <https://www.ferd-net.de/en/downloads/publications/details/zugferd-252-english>
- FeRD/FNFE-MPE, Pressemitteilung ZUGFeRD 2.5 / Factur-X 1.09 (10.06.2026) — <https://www.ferd-net.de/fileadmin/user_upload/FeRD/f%C3%BCr_FeRD-Meldungen/20260610_Factur-X_1_09_ZUGFeRD_2_5_Press_Release_FR.pdf>
