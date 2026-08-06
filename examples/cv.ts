/**
 * A CV / résumé — the layout class that stresses fast-pdf hardest: a
 * full-height sidebar on every page, a circular portrait, blocks whose
 * height must be known before they are drawn, and a skill matrix that
 * flows through two columns.
 *
 * Every one of those used to require hand-written layout code. Here they
 * are the 0.6.0 primitives:
 *
 *   region()        — the sidebar, flowing inside a fixed box in a decorator
 *   image({shape})  — the round portrait, clipped server-side (no Canvas)
 *   measureText()   — the summary panel, sized to its own text
 *   fontMetrics()   — bullets centred optically, not by a magic constant
 *   flowColumns()   — the skill matrix, balanced across two columns
 *   keepTogether()  — job entries that never split across a page
 *   table render    — the proficiency bars inside table cells
 *
 * Run: npx tsx examples/cv.ts
 */
import { mkdir } from "node:fs/promises";
import { PDFDocument } from "../src/index";

// ── Palette ──────────────────────────────────────────────────────────────
const INK = "#101828";
const ACCENT = "#2563eb";
const MUTED = "#64748b";
const BODY = "#334155";
const FAINT = "#e2e8f0";
const SIDEBAR_TEXT = "#e2e8f0";
const SIDEBAR_W = 176;

// ── Content ──────────────────────────────────────────────────────────────
const PERSON = {
  name: "Alex Berger",
  role: "Senior Full-Stack-Entwickler",
  summary:
    "Senior Full-Stack-Entwickler mit Schwerpunkt auf typsicheren Frontend/Backend-Architekturen, " +
    "Design-Systemen und Cloud/DevOps-Automatisierung. Zwölf Jahre Erfahrung zwischen Produktteams " +
    "und Plattform-Engineering.",
};

const CONTACT: [string, string][] = [
  ["E-Mail", "alex.berger@example.com"],
  ["Telefon", "+49 151 23456789"],
  ["Ort", "Berlin, Deutschland"],
  ["Web", "alex-berger.example"],
];

const LANGUAGES: [string, string][] = [
  ["Deutsch", "Muttersprache"],
  ["Englisch", "C1"],
  ["Französisch", "B1"],
];

const JOBS = [
  {
    title: "Lead Engineer · Northwind",
    span: "2023 – heute",
    body: "Aufbau eines unternehmensweiten Design-Systems und Migration der Kundenplattform auf eine Server-Components-Architektur. Führung eines Teams von sechs Entwicklerinnen und Entwicklern.",
  },
  {
    title: "Senior Developer · Contoso",
    span: "2020 – 2023",
    body: "Verantwortung für Zahlungsabwicklung, Observability und die interne Komponentenbibliothek. Reduktion der p95-Latenz um 40 % durch konsequentes Caching.",
  },
  {
    title: "Developer · Fabrikam",
    span: "2017 – 2020",
    body: "Entwicklung eines mandantenfähigen Reporting-Backends inklusive PDF-Export und geplanter Auslieferung per E-Mail.",
  },
];

const SKILLS: [string, string[]][] = [
  ["Sprachen", ["TypeScript", "Go", "Python", "SQL"]],
  ["Frontend", ["React", "Next.js", "Tailwind", "Vite", "Storybook"]],
  ["Backend", ["Node.js", "PostgreSQL", "Redis", "gRPC"]],
  ["Cloud/DevOps", ["AWS", "Terraform", "Kubernetes", "GitHub Actions"]],
  ["Testing", ["Vitest", "Playwright", "k6"]],
  ["Verfahren", ["Domain-Driven-Design", "Trunk-Based-Development", "Continuous-Delivery"]],
];

const FOCUS: [string, string, number][] = [
  ["PDF-Generierung", "6 Jahre", 0.95],
  ["Design-Systeme", "4 Jahre", 0.8],
  ["Verteilte Systeme", "3 Jahre", 0.6],
];

const pdf = new PDFDocument({
  // /Lang matters here: ATS parsers and screen readers both read it.
  language: "de-DE",
  margins: { top: 52, right: 46, bottom: 52, left: SIDEBAR_W + 30 },
  metadata: { title: `Lebenslauf — ${PERSON.name}`, author: PERSON.name },
});

// ── Sidebar ──────────────────────────────────────────────────────────────
// One region() per page. No manual y bookkeeping, no fits() helper, and it
// says out loud when the content stops fitting.
pdf.onPage((doc, info) => {
  doc.rect(0, 0, SIDEBAR_W, info.size.height, { fill: INK });

  // A vector portrait placeholder, clipped to a circle. With a real photo
  // this is image(bytes, { shape: "circle", fit: "cover" }) — same clip.
  const cx = SIDEBAR_W / 2;
  doc.clip({ x: cx - 48, y: 46, width: 96, height: 96, radius: 48 }, (d) => {
    d.rect(cx - 48, 46, 96, 96, { fill: "#1d2b45" });
    d.circle(cx, 116, 34, { fill: ACCENT, opacity: 0.9 }); // shoulders
    d.circle(cx, 84, 19, { fill: "#93b4ff" }); // head
  });

  const result = doc.region(
    { x: 30, y: 168, width: SIDEBAR_W - 60, height: info.size.height - 220 },
    (d) => {
      const label = (t: string): void => {
        d.text(t, {
          color: "#7aa2ff",
          size: 7.5,
          bold: true,
          letterSpacing: 1.4,
          spacingBefore: 22,
          spacingAfter: 8,
        });
      };

      label("KONTAKT");
      for (const [key, value] of CONTACT) {
        d.text(key, { color: MUTED, size: 7 });
        d.text(value, { color: SIDEBAR_TEXT, size: 8.5, spacingAfter: 8 });
      }

      label("SPRACHEN");
      for (const [name, level] of LANGUAGES) {
        // Optical centring straight from the font, not a tuned constant.
        const m = d.fontMetrics({ size: 8.5 });
        d.circle(d.x + 2, d.y + m.baseline - m.capHeight / 2, 1.8, { fill: "#7aa2ff" });
        d.text(`${name} · ${level}`, { x: 11, color: SIDEBAR_TEXT, size: 8.5, spacingAfter: 6 });
      }
    },
  );
  if (result.overflow) {
    console.warn(`sidebar overflows by ${(-result.remaining).toFixed(1)}pt`);
  }

  // Rotated page marginalia along the spine.
  doc.text(`Seite ${info.pageNumber} / ${info.pageCount}`, {
    x: 15,
    y: info.size.height - 46,
    rotate: -90,
    color: MUTED,
    size: 7,
    letterSpacing: 1.2,
  });
});

// ── Header ───────────────────────────────────────────────────────────────
pdf.text(PERSON.name, { size: 27, bold: true, color: INK });
pdf.text(PERSON.role, { size: 12, color: ACCENT, spacingAfter: 12 });

// The summary sits on a tinted panel whose height comes from the text.
// Note the coordinate mode: with `y` given, `x` is an ABSOLUTE page
// coordinate — so the inset is `pdf.x + 12`, not `12`.
const summary = pdf.measureText(PERSON.summary, {
  size: 9.5,
  lineHeight: 1.5,
  width: pdf.width - 24,
});
pdf.rect(pdf.x, pdf.y, pdf.width, summary.height + 22, { fill: ACCENT, opacity: 0.06, radius: 6 });
pdf.text(PERSON.summary, {
  x: pdf.x + 12,
  y: pdf.y + 11,
  width: pdf.width - 24,
  size: 9.5,
  lineHeight: 1.5,
  color: BODY,
});
pdf.y += summary.height + 22 + 26;

// ── Experience ───────────────────────────────────────────────────────────
const section = (title: string): void => {
  pdf.text(title, {
    size: 8,
    bold: true,
    letterSpacing: 1.6,
    color: ACCENT,
    spacingBefore: 8,
    spacingAfter: 11,
  });
};

section("BERUFSERFAHRUNG");
for (const job of JOBS) {
  // The whole entry moves to the next page together, or not at all.
  pdf.keepTogether((d) => {
    d.text(job.title, { size: 10.5, bold: true, color: INK });
    d.text(job.span, { size: 8, color: MUTED, spacingAfter: 4 });
    d.text(job.body, { size: 9, color: BODY, lineHeight: 1.45, spacingAfter: 15 });
  });
}

// ── Skill matrix ─────────────────────────────────────────────────────────
section("SKILL-MATRIX");
const flow = pdf.flowColumns(
  SKILLS.map(([name, items]) => ({
    render: (d: PDFDocument) => {
      d.text(name, { size: 9, bold: true, color: INK, spacingAfter: 3 });
      d.text(items.join(" · "), { size: 8.5, color: BODY, lineHeight: 1.4 });
    },
    spacingBefore: 13,
    keepWithNext: true,
  })),
  { columns: 2, gap: 26, balance: true },
);

// ── Focus table with rendered proficiency bars ───────────────────────────
pdf.y += 26;
section("SCHWERPUNKTE");
pdf.table(
  [
    ["Bereich", "Erfahrung", "Niveau"],
    ...FOCUS.map(([area, years, level]) => [
      area,
      { text: years, valign: "middle" as const },
      {
        valign: "middle" as const,
        render: (d: PDFDocument, box: { x: number; y: number; width: number }) => {
          d.rect(box.x, box.y, box.width, 7, { fill: FAINT, radius: 3.5 });
          d.rect(box.x, box.y, box.width * level, 7, { fill: ACCENT, radius: 3.5 });
          d.y = box.y + 7; // report the height used
        },
      },
    ]),
  ],
  {
    widths: [150, 90, 128],
    headerFill: "#f1f5f9",
    headerColor: INK,
    borderColor: FAINT,
    fontSize: 9,
    padding: 7,
  },
);

await mkdir("examples/output", { recursive: true });
await pdf.save("examples/output/cv.pdf");
console.log(`→ examples/output/cv.pdf (${pdf.pageCount} page(s), skills over ${flow.pages})`);
