---
name: fast-pdf-designer
description: Design polished PDF documents (invoices, reports, contracts, dashboards) with the fast-pdf library. Use whenever creating or restyling a PDF built with fast-pdf — provides curated palettes, typography rules, layout recipes (letterhead, totals block, signature area, KPI cards) and the render-preview-iterate validation loop.
---

# fast-pdf designer

Design knowledge for building PDFs with fast-pdf that look professionally
designed, not generated. Workflow: **copy the closest template, restyle it,
then verify visually** — never ship a PDF you haven't looked at.

## 1 · Start from a template

Don't start from a blank file. Copy the closest example and adapt:

| Template | Use for |
|---|---|
| `examples/invoice.ts` | Invoices, quotes, order confirmations — letterhead, item table, totals block |
| `examples/report.ts` | Design-forward reports — full-bleed cover, KPI cards, vector bar chart, dark theme |
| `examples/signature.ts` | Contracts & agreements — clause sections, side-by-side AcroForm signature fields |
| `examples/showcase.ts` | Feature reference — TOC, outlines, watermark, spans, columns, links |
| `examples/basic.ts` | Minimal starting point |

In a project that installed the package, the templates live in
`node_modules/fast-pdf/examples/` — copy one into the project and change the
import from `"../src/index"` to `"fast-pdf"`; everything else works as-is.
Inside the fast-pdf repo itself, use `examples/` and keep the `"../src/index"`
import. Run with `npx tsx <file>`.

## 2 · Design system

### Palettes

Pick ONE palette and stay inside it. 1 accent + neutrals is enough; never mix
more than 2 accent hues on light documents.

**Corporate light** (invoices, contracts):
ink `#101828` · muted `#667085` · faint `#e4e7ec` · panel `#f8f9fc` · accent: indigo `#4f46e5` or navy `#0f172a`

**Editorial dark** (covers, dashboards — see report.ts):
ground `#0e1b2b` · panel `#16283b` · text `#eef3f7` · muted `#7c93a8` · accents coral `#ff7a5c`, gold `#ffd166`, mint `#55e6c1`

Rules: body text never pure black on white — use ink/`#334155`. Meta text and
labels use muted. Hairlines (`#e4e7ec`, width 0.5) instead of full borders.
Zebra fills barely visible (`#f8fafc`).

### Typography

Only size, weight, color and letterSpacing — that's the whole toolkit, so use
it deliberately:

- **Scale:** one display size (20–34, covers up to 92), section heads 11.5–14 bold,
  body 10–11, meta/labels 8–9.5. Never more than 4 sizes per document.
- **Eyebrow labels** (small caps line above a title): uppercase, 9–13 pt, bold,
  accent color, `letterSpacing: 2–4`. Instantly reads as "designed".
- Body copy: `lineHeight: 1.4–1.6`, `color` one step muted, max ~70 chars wide.
- Numbers in tables: `align: "right"`, format with `toLocaleString`.

### Spacing

Margins 50–70 pt. Breathing room beats boxes: separate sections with
whitespace (`moveDown`, `spacingAfter`) and hairlines, not borders. Align
everything to the left margin or the right margin — nothing in between.

## 3 · Layout recipes

**Letterhead** — accent bar + name + meta line:
```ts
pdf.rect(0, 0, page.width, 6, { fill: ACCENT });          // full-bleed top bar
pdf.text("INVOICE", { y: 52, size: 11, bold: true, color: ACCENT, letterSpacing: 3 });
pdf.text("R-2026-0042", { y: 72, size: 26, bold: true, color: INK });
pdf.text("Issued 19.07.2026 · due in 14 days", { y: 106, size: 9.5, color: MUTED });
```

**Address / meta row** — two blocks, absolute positioning:
```ts
pdf.y = 150;
pdf.text("Client AG\nMain St 1\n10115 Berlin", { lineHeight: 1.4 });
pdf.text("Invoice no: R-2026-0042\nDate: 19.07.2026", {
  y: 150, x: page.width - 250, width: 200, align: "right", color: MUTED, lineHeight: 1.4 });
```

**Item table + totals block** — the totals are a second, borderless table:
```ts
pdf.table(rows, { widths: [40, 230, 60, 80, 85], aligns: ["left","left","right","right","right"],
  headerFill: INK, headerColor: "#ffffff", zebraFill: "#f8fafc" });
pdf.moveDown(0.5);
pdf.table([["Subtotal", fmt(net)], ["VAT 19 %", fmt(vat)],
  [{ text: "Total", bold: true }, { text: fmt(gross), bold: true }]],
  { header: false, widths: [405, 90], aligns: ["right","right"], borderWidth: 0 });
```

**KPI cards** — `grid()` of containers (or absolute rects on dark covers):
```ts
pdf.grid(kpis.map((k) => (d) => {
  d.text(k.label, { size: 8.5, bold: true, color: MUTED, letterSpacing: 1.5 });
  d.text(k.value, { size: 22, bold: true, color: INK });
}), { columns: 3, gap: 10 });
```

**Signature area** — soft panel + two absolute fields (see signature.ts):
```ts
pdf.rect(46, y - 18, page.width - 92, 128, { fill: PANEL });
pdf.signature({ name: "client",     label: "Client · place, date",     x: 60,  y: y + 16, width: 210, height: 56 });
pdf.signature({ name: "contractor", label: "Contractor · place, date", x: 325, y: y + 16, width: 210, height: 56 });
```

**Footer** — hairline + centered 8 pt meta, via absolute y near page bottom
(single page) or `pdf.footer()` (every page).

## 4 · Validation loop (mandatory)

Generate → look at it → fix. Repeat until it looks right:

```sh
npx tsx examples/invoice.ts                     # 1 · generate
sips -g pixelWidth examples/output/invoice.pdf  # 2 · sanity check: valid PDF?
sips -s format png examples/output/invoice.pdf --out /tmp/preview.png   # 3 · render page 1
```

Then **Read the PNG** and check: palette consistent? alignment clean (left
edges, right-aligned numbers)? spacing even? nothing overlapping or touching
the margins? `sips` renders only page 1 — for multi-page docs use
`pdftoppm -png -r 100 in.pdf /tmp/page` if available, or move the content in
question to page 1 temporarily.

## 5 · API pitfalls

- Coordinates are **top-left based, in points**; A4 = 595.28 × 841.89.
- Passing `y` to text/image/signature switches to **absolute mode**: no flow,
  no cursor movement, no page breaks. Omit `y` to flow.
- `pdf.y` reads/sets the flow cursor; `pdf.pageSize` gives `{ width, height }`.
- `pageBreak()` throws inside `container()` / `columns()` / `grid()` — those
  blocks guarantee one-page content.
- `toc()` must be the **last** call before saving.
- `signature()` names must be unique per document; omit `name` for auto-numbering.
- Full-bleed backgrounds need `margins: 0` (report.ts) or absolute `rect()`s.
- Custom fonts: register every variant you use (`bold: true` etc.); missing
  variants silently fall back to regular.