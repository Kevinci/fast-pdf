/**
 * A modern, design-forward report — shows what fast-pdf can do beyond
 * invoices: full-bleed color, a vector bar chart, big type, decorative
 * shapes. Two pages: a cover and a metrics dashboard.
 *
 * Run: npx tsx examples/report.ts
 */
import { mkdir } from "node:fs/promises";
import { PDFDocument } from "../src/index";

// ── Palette ──────────────────────────────────────────────────────────────
const INK = "#0e1b2b"; // deep petrol-navy, full-bleed ground
const PANEL = "#16283b"; // slightly lifted card surface
const CORAL = "#ff7a5c";
const GOLD = "#ffd166";
const MINT = "#55e6c1";
const TEXT = "#eef3f7";
const MUTED = "#7c93a8";

const PAGE = { width: 595.28, height: 841.89 };

const pdf = new PDFDocument({
  margins: 0,
  metadata: { title: "Growth Report 2026", author: "fast-pdf", subject: "Annual metrics" },
});

// Blend two hex colors (t = 0..1) — used for the bar-chart gradient.
function mix(a: string, b: string, t: number): string {
  const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [ar, ag, ab] = h(a);
  const [br, bg, bb] = h(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(c(ar!, br!))}${hex(c(ag!, bg!))}${hex(c(ab!, bb!))}`;
}

// ── Page 1 — Cover ─────────────────────────────────────────────────────────
pdf.rect(0, 0, PAGE.width, PAGE.height, { fill: INK });

// Decorative shapes: oversized rings bleeding off the top-right corner.
pdf.circle(560, 90, 150, { stroke: CORAL, lineWidth: 1.5 });
pdf.circle(560, 90, 96, { stroke: mix(INK, CORAL, 0.5), lineWidth: 1 });
pdf.circle(505, 150, 10, { fill: GOLD });
pdf.circle(120, 700, 220, { stroke: mix(INK, MINT, 0.35), lineWidth: 1 });

pdf.text("ANNUAL REPORT", {
  x: 60, y: 150, size: 13, color: MINT, letterSpacing: 4, bold: true,
});
pdf.text("Growth", { x: 58, y: 250, size: 92, bold: true, color: TEXT });
pdf.text("Report", { x: 58, y: 340, size: 92, bold: true, color: CORAL });

pdf.text("2026", { x: 62, y: 452, size: 34, color: GOLD, letterSpacing: 10 });

pdf.line(60, 540, 300, 540, { color: mix(INK, MUTED, 0.6), width: 1 });
pdf.text(
  "A year of building the fastest way to create PDFs — measured, " +
    "compressed and shipped without a single browser in sight.",
  { x: 60, y: 560, width: 380, size: 13, color: MUTED, lineHeight: 1.6 },
);

pdf.text("PREPARED BY", { x: 60, y: 740, size: 9, color: MUTED, letterSpacing: 3 });
pdf.text("fast-pdf", { x: 60, y: 760, size: 13, bold: true, color: MINT });

// ── Page 2 — Dashboard ─────────────────────────────────────────────────────
pdf.pageBreak();
pdf.rect(0, 0, PAGE.width, PAGE.height, { fill: INK });

const M = 48; // page margin for this layout
pdf.text("PERFORMANCE", { x: M, y: 56, size: 11, color: MINT, letterSpacing: 4, bold: true });
pdf.text("Fourth quarter at a glance", { x: M, y: 74, size: 24, bold: true, color: TEXT });

// KPI cards ------------------------------------------------------------------
const kpis = [
  { label: "REVENUE", value: "€1.24M", delta: "+38%", accent: CORAL },
  { label: "ACTIVE USERS", value: "84,210", delta: "+21%", accent: GOLD },
  { label: "AVG. RENDER", value: "1.6 ms", delta: "-12%", accent: MINT },
];
const cardW = (PAGE.width - M * 2 - 2 * 16) / 3;
const cardY = 120;
const cardH = 104;
kpis.forEach((k, i) => {
  const x = M + i * (cardW + 16);
  pdf.rect(x, cardY, cardW, cardH, { fill: PANEL, radius: 12 });
  pdf.rect(x, cardY, 4, cardH, { fill: k.accent, radius: 2 }); // accent rail
  pdf.text(k.label, { x: x + 18, y: cardY + 20, size: 9, color: MUTED, letterSpacing: 2 });
  pdf.text(k.value, { x: x + 18, y: cardY + 40, size: 28, bold: true, color: TEXT });
  pdf.text(k.delta + " vs Q3", { x: x + 18, y: cardY + 78, size: 11, color: k.accent });
});

// Bar chart ------------------------------------------------------------------
const chartX = M;
const chartTop = 276;
const chartH = 200;
const chartW = PAGE.width - M * 2;
const months = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const values = [52, 61, 58, 74, 83, 100];
const maxV = 100;

pdf.text("MONTHLY GROWTH INDEX", { x: chartX, y: chartTop - 28, size: 10, color: MUTED, letterSpacing: 2 });

// Faint horizontal grid lines + scale labels.
for (let g = 0; g <= 4; g++) {
  const gy = chartTop + (chartH * g) / 4;
  pdf.line(chartX, gy, chartX + chartW, gy, { color: mix(INK, MUTED, 0.25), width: 0.5 });
  pdf.text(String(maxV - (maxV / 4) * g), {
    x: chartX + chartW + 8, y: gy - 5, size: 8, color: MUTED,
  });
}

const slot = chartW / months.length;
const barW = 34;
values.forEach((v, i) => {
  const h = (v / maxV) * chartH;
  const x = chartX + i * slot + (slot - barW) / 2;
  const y = chartTop + chartH - h;
  const fill = i === values.length - 1 ? GOLD : mix(mix(INK, MINT, 0.55), CORAL, i / (months.length - 1));
  pdf.rect(x, y, barW, h, { fill, radius: 6 });
  pdf.text(months[i]!, { x, y: chartTop + chartH + 8, width: barW, align: "center", size: 9, color: MUTED });
});

// Highlight callout ----------------------------------------------------------
const calloutY = 540;
pdf.rect(M, calloutY, chartW, 150, { fill: PANEL, radius: 16 });
const ringX = M + 82;
const ringY = calloutY + 75;
pdf.circle(ringX, ringY, 56, { stroke: mix(PANEL, MUTED, 0.4), lineWidth: 2 }); // faint outer track
pdf.circle(ringX, ringY, 46, { stroke: MINT, lineWidth: 7 }); // mint progress ring
pdf.text("94", { x: ringX - 30, y: ringY - 22, size: 34, bold: true, color: TEXT });
pdf.text("%", { x: ringX + 26, y: ringY - 14, size: 16, color: MINT });

pdf.text("Documents rendered under 5 ms", {
  x: M + 180, y: calloutY + 44, size: 16, bold: true, color: TEXT,
});
pdf.text(
  "Direct-to-PDF synthesis keeps 94 % of all generated documents under the " +
    "5-millisecond mark — no Chromium, no cold starts, constant memory.",
  { x: M + 180, y: calloutY + 72, width: chartW - 210, size: 11, color: MUTED, lineHeight: 1.6 },
);

// Footer rule ----------------------------------------------------------------
pdf.line(M, 770, PAGE.width - M, 770, { color: mix(INK, MUTED, 0.4), width: 0.75 });
pdf.text("fast-pdf · Growth Report 2026", { x: M, y: 784, size: 9, color: MUTED, letterSpacing: 1 });
pdf.text("Generated in 0.9 ms", {
  x: M, y: 784, width: chartW, align: "right", size: 9, color: MUTED,
});

await mkdir("examples/output", { recursive: true });
await pdf.save("examples/output/report.pdf");
console.log("→ examples/output/report.pdf");
