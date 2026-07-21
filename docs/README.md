# fast-pdf – Enterprise Roadmap (v1.0 → v3.0)

> Ergänzende Langfrist-Roadmap zur schlanken [ROADMAP.md](./ROADMAP.md) (v1.0-Fokus).
> Diese Datei beschreibt den Weg von einem schnellen PDF-Generator hin zu einer
> Referenzbibliothek für sichere, deterministische und regulatorisch taugliche
> PDF-Erzeugung im JavaScript-Ökosystem.

## Vision

fast-pdf soll die schnellste, sicherste und modernste PDF-Bibliothek für
JavaScript, TypeScript, Node.js, Bun, Deno und Browser werden – mit Fokus auf
Enterprise-Anforderungen aus Banken, Versicherungen, Behörden und regulierten
Branchen.

---

## Phase 1 – Foundation (v1.0)

**Ziel:** Solides, schnelles Fundament.

### Core

- [x] Zero Dependencies
- [x] Tree-Shakable Architektur
- [x] ESM First
- [x] CJS Compatibility
- [x] Browser Support
- [x] Node Support
- [x] Bun Support
- [x] Deno Support
- [x] TypeScript First
- [x] 100 % Strict Mode
- [x] Moderne modulare Architektur
- [x] Plugin-fähige interne Struktur
- [x] Streaming-orientierte Architektur vorbereiten

### PDF Features

- [ ] Text
- [ ] Fonts
- [ ] Images
- [ ] Shapes
- [ ] Tables
- [ ] Headers & Footers
- [ ] Pagination
- [ ] Links
- [ ] Metadata
- [ ] Multi Page Support

### Qualität

- [ ] Unit Tests
- [ ] Integration Tests
- [ ] Snapshot Tests
- [ ] Performance Tests
- [ ] API Tests
- [ ] 95 %+ Test Coverage

### Developer Experience

- [ ] Vollständige TypeScript-Dokumentation
- [ ] API Reference
- [ ] Beispiele
- [ ] Playground
- [ ] Benchmarks
- [ ] Migration Guides
- [ ] Changelog

---

## Phase 2 – Performance (v1.2)

**Ziel:** Schnellste PDF-Bibliothek im JavaScript-Ökosystem.

### Performance

- [ ] Zero Allocation Hot Paths
- [ ] Lazy Object Creation
- [ ] Memory Pooling
- [ ] Object Reuse
- [ ] Optimierter String Builder
- [ ] Binary Writer
- [ ] Streaming Writer
- [ ] Große Dokumente (> 10.000 Seiten)
- [ ] Geringer Speicherverbrauch

### Benchmarks

Vergleich gegen:

- pdf-lib
- PDFKit
- jsPDF
- PDFMake

Messung von:

- Geschwindigkeit
- Speicher
- Dateigröße
- CPU

---

## Phase 3 – Enterprise Security (v1.5)

**Ziel:** Sicherheit für Banken und Versicherungen.

> Stand 2026-07-20: Die numerische Eingabehärtung ist umgesetzt
> (`src/validate.ts` + typisierter `fmtNumber`-Fallback; neuer Fehlercode
> `INVALID_NUMBER`). Injection-/Escaping-Schutz war bereits vorhanden und ist
> durch `tests/security.test.ts` abgedeckt.

### Secure PDF Generation

- [x] PDF Injection Protection (String-/Name-Escaping, Link-Scheme-Filter)
- [x] Escaping aller PDF-Strings (`escapeString`, `serializeName`)
- [ ] UTF-8 Validation (aktuell: nicht abbildbare Zeichen → Ersatzzeichen statt Abbruch)
- [x] Input Validation (numerische Entry-Points werfen `INVALID_NUMBER`)
- [x] Null-Byte Protection (Null-Bytes werden oktal/`#00` escaped, nie roh)
- [x] Numeric Validation (`assertFinite` — NaN/±Infinity abgewiesen)
- [x] Overflow Protection (Betrag ≥ 1e21 abgewiesen, kein Exponent-Syntaxbruch)
- [x] Unterbindung ungültiger PDF-Objekte (`fmtNumber` wirft typisiert)

### Memory Safety

- [x] Begrenzte Buffer-Größen (`IMAGE_TOO_LARGE`, `inflate` mit `maxBytes`)
- [ ] Streaming statt Full Buffer (`toStream()` puffert heute noch)
- [x] Keine unkontrollierten Speicherallokationen (Dekompressions-/Pixel-Limits)
- [x] Sichere Fehlerbehandlung (alle Fehler als `FastPDFError` mit stabilem Code)
- [ ] Keine Endlosschleifen bei fehlerhaften Dokumenten

### Secure API

- [ ] Immutable Public API
- [x] Konsistente Fehlerklassen (`FastPDFError` + `FastPDFErrorCode`)
- [ ] Keine versteckten Seiteneffekte
- [ ] Deterministisches Verhalten (byte-identisch: siehe Phase 4)

---

## Phase 4 – Compliance (v2.0)

> Stand 2026-07-20: Deterministische Ausgabe ist umgesetzt — die Option
> `deterministic: true` erzeugt byte-identische PDFs (kein Wall-Clock-Zeitstempel,
> sofern kein `creationDate` gesetzt ist). Jedes Dokument trägt jetzt ein aus dem
> Dateiinhalt abgeleitetes `/ID` im Trailer. Abgedeckt durch `tests/document.test.ts`.

### Deterministische PDFs

- [x] Byte-identische PDFs (`deterministic: true`)
- [x] Abschaltbare Zeitstempel (weggelassen bzw. per `creationDate` fixierbar)
- [x] Stabile Objekt-IDs (deterministische Objekt-Reihenfolge)
- [x] Reproduzierbare Hashes (inhaltsabgeleitetes `/ID`, stabil bei stabilem Input)

Ideal für:

- Digitale Signaturen
- Archivierung
- Revisionssicherheit
- Dokumentenvergleich

### Standards

- [ ] PDF 1.7
- [ ] PDF/A-1
- [ ] PDF/A-2
- [ ] PDF/A-3
- [ ] XMP Metadata
- [ ] Unicode
- [ ] Embedded Fonts

### Accessibility

- [ ] Tagged PDF
- [ ] Lese-Reihenfolge
- [ ] Alt-Texte
- [ ] Screenreader-Unterstützung

---

## Phase 5 – Security & Cryptography (v2.2)

> Stand 2026-07-21: Verschlüsselung ist umgesetzt — der AES-256-Standard-Handler
> (Revision 6, PDF 2.0) über die Option `encrypt`. Bewusst **nur R6/AES-256**
> (SHA-256/384/512 + AES-256 über WebCrypto, keine RC4/MD5-Altlasten). End-to-End
> gegen macOS Quartz validiert; Reader-seitige Passwort-Prüfung (Algorithm 11) in
> `tests/encryption.test.ts` unabhängig nachgebaut.

### Encryption

- [ ] AES-128 (bewusst ausgelassen — R4 bräuchte MD5; R6/AES-256 ist sicherer)
- [x] AES-256 (Standard Security Handler V5 / R6, AESV3)
- [x] User Password (Öffnen-Passwort; leer = ohne Prompt)
- [x] Owner Password (volle Rechte)
- [x] Permissions (Drucken, Kopieren, Ändern, Annotieren, Formulare, …)
- [x] Document Protection (Strings **und** Streams werden verschlüsselt)

> Stand 2026-07-21: Digitale Signaturen sind umgesetzt — detached **PAdES-B
> (CAdES)** über `signature({ sign })`. Schlüssel/Zertifikat als PEM, CMS
> selbst gebaut, Signatur (RSA+SHA-256) über WebCrypto. Gegen
> `openssl cms -verify` und Quartz validiert; In-Process-Verifikation in
> `tests/signing.test.ts`.

### Digital Signatures

- [x] Signature Placeholder (leeres `/Sig`-Feld — existierte, jetzt auch signiert)
- [x] Hash Support (SHA-256, messageDigest bindet die ByteRange)
- [x] PKCS#7 (CMS SignedData, `adbe`-kompatibel)
- [x] PAdES Ready (PAdES-B: `ETSI.CAdES.detached` + signing-certificate-v2)
- [ ] Mehrere Signaturen (aktuell genau eine signierte Signatur pro Dokument)
- [ ] Timestamp Support (RFC 3161 TSA — nur `signingTime`-Attribut bisher)

### Dokumentintegrität

- [ ] Hash Verification
- [ ] Integrity Checks
- [ ] Optional Verification API

---

## Phase 6 – Enterprise Features (v2.5)

### Streaming

- [ ] Streaming Writer
- [ ] Streaming Reader
- [ ] Gigabyte-Dokumente
- [ ] Niedriger RAM-Verbrauch

### Skalierung

- [ ] Parallel Rendering
- [ ] Worker Support
- [ ] Web Worker
- [ ] Node Worker Threads

### Enterprise API

- [ ] Konfigurierbare Policies
- [ ] Logging Hooks
- [ ] Audit Hooks
- [ ] Erweiterbare Pipeline

---

## Phase 7 – Qualität & Stabilität (v2.8)

### Testing

- [ ] Unit Tests
- [ ] Integration Tests
- [ ] Regression Tests
- [ ] Property Tests
- [ ] Fuzz Tests
- [ ] Random Input Generator
- [ ] Millionen Testfälle

### CI

Plattformen:

- Linux
- macOS
- Windows
- Node LTS
- Bun
- Deno

Automatisch:

- Lint
- Typecheck
- Tests
- Coverage
- Benchmarks
- Security Checks

---

## Phase 8 – Supply Chain Security (v3.0)

### Sichere Releases

- [ ] Signierte Git Tags
- [ ] Signierte npm Releases
- [ ] Reproduzierbare Builds
- [ ] Verifizierbare Artefakte
- [ ] Automatische Release Notes

### Security

- [ ] SECURITY.md
- [ ] Responsible Disclosure
- [ ] CVE-Prozess
- [ ] Security Advisories
- [ ] Security Policy

---

## Lizenz

Die MIT-Lizenz ist sehr verbreitet und wird auch in Unternehmen akzeptiert. Um
Missbrauch zu erschweren und gleichzeitig die Offenheit zu erhalten, können
folgende Maßnahmen ergänzt werden:

### Beibehalten

- [x] MIT License

### Ergänzen

- [ ] NOTICE-Datei
- [ ] AUTHORS
- [ ] SECURITY.md
- [ ] CODE_OF_CONDUCT.md
- [ ] CONTRIBUTING.md
- [ ] SUPPORTED_VERSIONS.md
- [ ] THIRD_PARTY_NOTICES.md (auch wenn sie zunächst leer ist)
- [ ] SPDX-Lizenzkennzeichnung in allen Quellcodedateien

### Schutz der Marke

Die MIT-Lizenz schützt den Namen "fast-pdf" nicht. Deshalb zusätzlich:

- den Projektnamen und das Logo als Marke schützen (Trademark, falls relevant),
- eine Trademark Policy veröffentlichen, die regelt, wann der Name verwendet
  werden darf,
- festlegen, dass Forks den Projektnamen oder das Logo nicht unverändert für
  eigene Veröffentlichungen nutzen dürfen.

So bleibt der Quellcode frei nutzbar, während die Identität und Reputation des
Projekts geschützt werden.

---

## Langfristige Vision (v4.0+)

- PDF/A-Zertifizierung
- PDF/X-Unterstützung
- PDF/UA
- Digitale Langzeitarchivierung
- Hardwarebeschleunigte PDF-Erzeugung (wo möglich)
- Optionaler nativer Renderer (Rust/WASM)
- Cloud-Rendering
- KI-gestützte Dokumentlayouts
- Enterprise-LTS-Versionen
- Langfristig eine Referenzbibliothek für sichere PDF-Erzeugung im
  JavaScript-Ökosystem

---

## Leitprinzipien

- Performance ohne Kompromisse
- Security by Design
- Zero Dependencies
- Deterministische Ergebnisse
- Langfristig stabile API
- Enterprise-Qualität
- Plattformübergreifend
- Ausführlich dokumentiert
- Reproduzierbare und signierte Releases
- MIT-lizenziert mit klarer Marken- und Sicherheitsstrategie

---

Mit dieser Roadmap wird fast-pdf nicht nur als schneller PDF-Generator
positioniert, sondern als eine Bibliothek, die die Anforderungen professioneller
Softwareentwicklung und regulierter Branchen von Beginn an berücksichtigt.
