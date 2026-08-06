/**
 * audit-pdf — listet sicherheitsrelevante Strukturen in einer PDF-Datei auf.
 *
 *   node scripts/audit-pdf.mjs datei.pdf [weitere.pdf …]
 *
 * Absichtlich **ohne jede Abhängigkeit zu fast-pdf**: das Werkzeug soll eine
 * unabhängige zweite Meinung sein. Wer prüfen will, ob append() wirklich
 * filtert, lässt es einmal über die Eingabedatei und einmal über das Ergebnis
 * laufen und vergleicht die Zahlen.
 *
 * Der wichtigste Trick steckt in stripStreams(): Stream-Inhalte werden vor der
 * Suche entfernt. Ohne diesen Schritt findet man "/JavaScript" auch dann, wenn
 * es bloß als sichtbarer Text auf einer Seite steht — Seiteninhalt wird von
 * append() bewusst unverändert kopiert, ist aber niemals eine Aktion. Genau
 * diese Verwechslung lässt einen Filter kaputt aussehen, der funktioniert.
 *
 * Grenze: Objekte, die in komprimierten Objekt-Streams (/ObjStm, PDF 1.5+)
 * liegen, sieht dieser Scanner nicht — er liest keine Kompression. Für die
 * *Ausgabe* von fast-pdf ist das unerheblich, die enthält nie Objekt-Streams.
 * Bei einer Eingabedatei kann die Zahl links zu niedrig sein; das Ergebnis
 * rechts bleibt aussagekräftig.
 */
import { readFileSync } from "node:fs";

/** Was gesucht wird: Bezeichnung, Muster, Warum es gefährlich ist. */
const CHECKS = [
  ["/OpenAction", /\/OpenAction\b/g, "Aktion, die beim Öffnen des Dokuments ausgeführt wird"],
  ["/AA", /\/AA\b/g, "Additional Actions: Trigger bei Seitenaufruf, Fokus, Mouseover"],
  ["/JavaScript", /\/JavaScript\b/g, "JavaScript-Aktion"],
  ["/JS", /\/JS\b/g, "JavaScript-Quelltext in einer Aktion"],
  ["/Launch", /\/Launch\b/g, "startet ein externes Programm"],
  ["/SubmitForm", /\/SubmitForm\b/g, "sendet Daten an einen Server"],
  ["/ImportData", /\/ImportData\b/g, "liest eine lokale Datei ein"],
  ["/GoToR", /\/GoToR\b/g, "Sprung in eine fremde Datei"],
  ["/GoToE", /\/GoToE\b/g, "Sprung in eine eingebettete Datei"],
  ["/Rendition", /\/Rendition\b/g, "Medienwiedergabe-Aktion"],
  ["/Movie", /\/Movie\b/g, "Film-Aktion oder -Annotation"],
  ["/Sound", /\/Sound\b/g, "Audio-Aktion oder -Annotation"],
  ["/EmbeddedFile", /\/EmbeddedFile\b/g, "eingebettete Datei"],
  ["/EmbeddedFiles", /\/EmbeddedFiles\b/g, "Namensbaum eingebetteter Dateien"],
  ["/FileAttachment", /\/FileAttachment\b/g, "Dateianlage-Annotation"],
  ["/Widget", /\/Widget\b/g, "Formularfeld"],
  ["/AcroForm", /\/AcroForm\b/g, "Formular im Katalog"],
  ["/XFA", /\/XFA\b/g, "XFA-Formular (eigene Skript-Engine)"],
  ["/RichMedia", /\/RichMedia\b/g, "eingebettetes Medienobjekt (Flash/3D)"],
  ["/Screen", /\/Screen\b/g, "Screen-Annotation für Medien"],
  ["/3D", /\/3D\b/g, "3D-Objekt"],
  ["javascript: URI", /javascript:/gi, "Skript-URI in einem Link"],
  ["/URI", /\/URI\b/g, "externer Weblink (harmlos, nur zur Info)"],
];

/** Annotationstypen, die append() durchlässt — Markup ohne Nebenwirkung. */
const HARMLESS = new Set(["/URI"]);

/**
 * Entfernt alle Stream-Nutzdaten. Übrig bleibt das Objektgerüst: genau dort,
 * und nur dort, können Aktionen und Anhänge stehen.
 */
function stripStreams(latin1) {
  let out = "";
  let at = 0;
  for (;;) {
    const start = latin1.indexOf("stream", at);
    if (start < 0) break;
    // "endstream" enthält "stream" — solche Treffer überspringen.
    if (latin1.startsWith("endstream", start - 3)) {
      out += latin1.slice(at, start + 6);
      at = start + 6;
      continue;
    }
    const end = latin1.indexOf("endstream", start);
    if (end < 0) break;
    out += latin1.slice(at, start + 6);
    out += `\n%%[${end - start} Bytes Streamdaten entfernt]%%\n`;
    at = end;
  }
  return out + latin1.slice(at);
}

function audit(path) {
  const bytes = readFileSync(path);
  const raw = bytes.toString("latin1");
  const structure = stripStreams(raw);

  const objects = (structure.match(/\b\d+ \d+ obj\b/g) ?? []).length;
  const objStms = (structure.match(/\/ObjStm\b/g) ?? []).length;
  const annots = [...structure.matchAll(/\/Subtype\s*\/(\w+)/g)]
    .map((m) => m[1])
    .filter((s) =>
      [
        "Link",
        "Widget",
        "FileAttachment",
        "Screen",
        "RichMedia",
        "Movie",
        "Sound",
        "Square",
        "Highlight",
        "Text",
        "FreeText",
        "Underline",
        "StrikeOut",
        "Squiggly",
        "Circle",
        "Line",
        "Polygon",
        "PolyLine",
        "Stamp",
        "Ink",
        "Caret",
        "Popup",
        "3D",
      ].includes(s),
    );

  const findings = [];
  for (const [label, pattern, why] of CHECKS) {
    const hits = (structure.match(pattern) ?? []).length;
    if (hits > 0) findings.push({ label, hits, why, harmless: HARMLESS.has(label) });
  }

  const risky = findings.filter((f) => !f.harmless);
  console.log(`\n${"─".repeat(72)}`);
  console.log(`${path}  ·  ${bytes.length.toLocaleString("de-DE")} Bytes  ·  ${objects} Objekte`);
  if (objStms > 0) {
    console.log(
      `  Hinweis: ${objStms} Objekt-Stream(s) — deren Inhalt kann dieser Scanner nicht lesen.`,
    );
  }
  console.log(`${"─".repeat(72)}`);

  if (risky.length === 0) {
    console.log("  Keine riskanten Strukturen gefunden.");
  } else {
    for (const f of risky) {
      console.log(`  ⚠ ${String(f.hits).padStart(3)}×  ${f.label.padEnd(16)} ${f.why}`);
    }
  }
  for (const f of findings.filter((x) => x.harmless)) {
    console.log(`  ·  ${String(f.hits).padStart(3)}×  ${f.label.padEnd(16)} ${f.why}`);
  }

  const counts = new Map();
  for (const a of annots) counts.set(a, (counts.get(a) ?? 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× /${k}`);
  console.log(`  Annotationen: ${list.length ? list.join(", ") : "keine"}`);
  console.log(
    `  ⇒ ${risky.length === 0 ? "SAUBER" : risky.reduce((n, f) => n + f.hits, 0) + " riskante Fundstellen"}`,
  );
  return risky.length;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Aufruf: node scripts/audit-pdf.mjs datei.pdf [weitere.pdf …]");
  process.exit(2);
}
let risky = 0;
for (const file of files) risky += audit(file);
console.log();
process.exit(risky === 0 ? 0 : 1);
