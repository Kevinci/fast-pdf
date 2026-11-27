import { ContentStream } from "../pdf/content";
import { Name, PDFString, textString, type PDFValue, type Ref } from "../pdf/objects";
import type { PDFWriter } from "../pdf/writer";
import { transformRect, type Matrix } from "../pdf/import";
import { resolveFont } from "../fonts/font";
import { wrapLines } from "../layout/text";
import { FastPDFError } from "../errors";
import type { RGB } from "../types/index";

/**
 * Interactive form fields (AcroForm, ISO 32000-1 §12.7) — the part of
 * `textField()`, `checkbox()`, `radioGroup()` and `dropdown()` that writes
 * objects: field dictionaries and their appearance streams.
 *
 * Every widget gets real appearance streams, and /NeedAppearances is never
 * set: the document must look the same in a viewer without form support, in
 * print and in a PDF/image converter as it does in Acrobat. Field text is set
 * in Helvetica (/Helv) and ticks and dots are vector paths, so no font beyond
 * the one standard font is involved — in particular no ZapfDingbats.
 *
 * Every string that reaches the file goes through `textString()` (field
 * dictionaries) or the content stream's literal escaping (appearances); no
 * user input is ever spliced into PDF syntax.
 */

/** Field flags (/Ff), ISO 32000-1 tables 221, 226, 228 and 230 (bit n = 1 << (n − 1)). */
const FF_READ_ONLY = 1;
const FF_REQUIRED = 1 << 1;
export const FF_MULTILINE = 1 << 12;
export const FF_PASSWORD = 1 << 13;
const FF_NO_TOGGLE_TO_OFF = 1 << 14;
const FF_RADIO = 1 << 15;
export const FF_COMBO = 1 << 17;
export const FF_EDIT = 1 << 18;

/** A choice as it is stored: export value and the label shown for it. */
export interface FieldOption {
  value: string;
  label: string;
}

interface FieldBox {
  /** Partial field name (/T) — unique within the document. */
  name: string;
  /** Top-left corner, top-based user coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Field flags (/Ff). */
  flags: number;
}

const invalid = (message: string): FastPDFError => new FastPDFError(message, "INVALID_ARGUMENT");

/**
 * Claim a field name: non-empty, no periods (a period separates the parts of
 * a fully qualified name, §12.7.3.2), not yet taken in this document.
 */
export function claimFieldName(taken: Set<string>, name: string): void {
  if (typeof name !== "string" || name === "" || name.includes(".")) {
    throw invalid(
      `Invalid form field name ${JSON.stringify(name)} — must be a non-empty string without periods`,
    );
  }
  if (taken.has(name)) throw invalid(`Form field name "${name}" is already used`);
  taken.add(name);
}

/** Normalize radio/dropdown options; rejects an empty list and duplicate values. */
export function fieldOptions(
  options: readonly (string | { value: string; label?: string })[],
  value: string | undefined,
  free: boolean,
): FieldOption[] {
  if (!Array.isArray(options) || options.length === 0) {
    throw invalid("options must be a non-empty array");
  }
  const seen = new Set<string>();
  const out = options.map((option) => {
    const v = typeof option === "string" ? option : option?.value;
    if (typeof v !== "string") throw invalid("every option needs a string value");
    if (seen.has(v)) throw invalid(`duplicate option value ${JSON.stringify(v)}`);
    seen.add(v);
    const label = typeof option === "string" ? option : (option.label ?? v);
    return { value: v, label: String(label) };
  });
  if (value !== undefined && (typeof value !== "string" || (!free && !seen.has(value)))) {
    throw invalid(`value ${JSON.stringify(value)} is not one of the options`);
  }
  return out;
}

/** ReadOnly and Required, the flags every field kind shares. */
export const baseFlags = (o: { readOnly?: boolean; required?: boolean }): number =>
  (o.readOnly === true ? FF_READ_ONLY : 0) | (o.required === true ? FF_REQUIRED : 0);

/** A pending form field on a page, in top-based user coordinates. */
export type PendingFormField =
  | (FieldBox & {
      kind: "text";
      /** Absent for password fields: their value never reaches the file. */
      value?: string;
      fontSize: number;
      /** Quadding (/Q): 0 left, 1 centre, 2 right. */
      quadding: number;
      maxLength?: number;
    })
  | (FieldBox & { kind: "choice"; options: FieldOption[]; value?: string; fontSize: number })
  | (FieldBox & { kind: "check"; checked: boolean })
  | (FieldBox & {
      kind: "radio";
      options: FieldOption[];
      /** Index of the selected option, -1 for none. */
      selected: number;
      /** Top-left corner of each option's circle; width = height = the circle size. */
      boxes: { x: number; y: number }[];
    });

/** Everything about the page a field is written for. */
export interface FieldContext {
  page: Ref;
  pageHeight: number;
  /** Set on a page copied from an appended PDF (see `ImportedParts.annotTransform`). */
  transform?: Matrix;
  /** Annotation flags (/F) — document.ts's ANNOT_PRINT. */
  annotFlags: number;
  /** The shared Helvetica font object — created on first use. */
  helvetica: () => Ref;
}

const BORDER: RGB = { r: 0.6, g: 0.62, b: 0.67 };
const BACKGROUND: RGB = { r: 1, g: 1, b: 1 };
const INK: RGB = { r: 0.1, g: 0.1, b: 0.12 };
const PADDING = 3;
/** Bézier circle approximation constant: 4/3 · (√2 − 1). */
const KAPPA = 0.5522847498;

/** /MK: border and background colours, so a viewer that regenerates matches ours. */
const MK = { BC: [BORDER.r, BORDER.g, BORDER.b], BG: [BACKGROUND.r, BACKGROUND.g, BACKGROUND.b] };

/**
 * Write one field: its dictionaries and appearance streams. Returns the
 * field to list in /AcroForm /Fields and the widgets to list in the page's
 * /Annots — the same object for every kind except the radio group, whose
 * parent field has one kid widget per option.
 */
export function writeFormField(
  writer: PDFWriter,
  field: PendingFormField,
  ctx: FieldContext,
): { field: Ref; widgets: Ref[] } {
  const { transform } = ctx;
  // On a rotated appended page, the appearance turns with the page: the
  // form's /Matrix carries the linear part, the widget's /MK /R tells a
  // viewer that regenerates the appearance to do the same.
  const matrix: Matrix | undefined =
    transform !== undefined && (transform[1] !== 0 || transform[2] !== 0 || transform[0] < 0)
      ? [transform[0], transform[1], transform[2], transform[3], 0, 0]
      : undefined;
  const rotation =
    matrix !== undefined
      ? (Math.round((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI) + 360) % 360
      : 0;

  const appearance = (w: number, h: number, ops: ContentStream, font?: Ref): Ref =>
    writer.addStream(
      {
        Type: new Name("XObject"),
        Subtype: new Name("Form"),
        BBox: [0, 0, w, h],
        Matrix: matrix,
        Resources: font !== undefined ? { Font: { Helv: font } } : {},
      },
      ops.toBytes(),
    );

  const widget = (x: number, y: number, w: number, h: number): Record<string, PDFValue> => {
    const box: [number, number, number, number] = [
      x,
      ctx.pageHeight - (y + h),
      x + w,
      ctx.pageHeight - y,
    ];
    return {
      Type: new Name("Annot"),
      Subtype: new Name("Widget"),
      Rect: transform !== undefined ? transformRect(transform, box) : box,
      F: ctx.annotFlags,
      P: ctx.page,
      MK: rotation !== 0 ? { ...MK, R: rotation } : MK,
    };
  };

  const { name, x, y, width, height, flags } = field;
  const common = { T: textString(name), Ff: flags !== 0 ? flags : undefined };

  if (field.kind === "radio") {
    const parent = writer.reserve();
    const widgets = field.boxes.map((b, i) => {
      const state = String(i);
      return writer.add({
        ...widget(b.x, b.y, width, height),
        Parent: parent,
        AS: new Name(i === field.selected ? state : "Off"),
        AP: {
          N: {
            [state]: appearance(width, height, radioAppearance(width, true)),
            Off: appearance(width, height, radioAppearance(width, false)),
          },
        },
      });
    });
    // State names are the option indices ("0", "1", …); the export values
    // live in /Opt as text strings, so any value — slashes, spaces, umlauts —
    // works without being squeezed into a PDF name.
    const value = new Name(field.selected >= 0 ? String(field.selected) : "Off");
    writer.fill(parent, {
      FT: new Name("Btn"),
      ...common,
      Ff: flags | FF_RADIO | FF_NO_TOGGLE_TO_OFF,
      Kids: widgets,
      V: value,
      DV: value,
      Opt: field.options.map((o) => textString(o.value)),
    });
    return { field: parent, widgets };
  }

  if (field.kind === "check") {
    const state = new Name(field.checked ? "Yes" : "Off");
    const ref = writer.add({
      ...widget(x, y, width, height),
      FT: new Name("Btn"),
      ...common,
      V: state,
      DV: state,
      AS: state,
      AP: {
        N: {
          Yes: appearance(width, height, checkAppearance(width, height, true)),
          Off: appearance(width, height, checkAppearance(width, height, false)),
        },
      },
    });
    return { field: ref, widgets: [ref] };
  }

  // Text and choice fields: a value set in Helvetica inside a framed box.
  const font = ctx.helvetica();
  const { fontSize, value } = field;
  let shown = value;
  let quadding = 0;
  let extra: Record<string, PDFValue | undefined>;
  if (field.kind === "text") {
    quadding = field.quadding;
    extra = {
      FT: new Name("Tx"),
      MaxLen: field.maxLength,
      Q: quadding !== 0 ? quadding : undefined,
    };
  } else {
    // A choice with a label different from its export value is written as an
    // [export label] pair (§12.7.4.4); the appearance shows the label.
    shown = field.options.find((o) => o.value === value)?.label ?? value;
    extra = {
      FT: new Name("Ch"),
      Opt: field.options.map((o) =>
        o.label === o.value ? textString(o.value) : [textString(o.value), textString(o.label)],
      ),
    };
  }
  const ref = writer.add({
    ...widget(x, y, width, height),
    ...extra,
    ...common,
    V: value !== undefined ? textString(value) : undefined,
    DV: value !== undefined ? textString(value) : undefined,
    DA: new PDFString(`/Helv ${fontSize} Tf 0 g`),
    AP: {
      N: appearance(
        width,
        height,
        textAppearance(width, height, shown ?? "", fontSize, quadding, field),
        font,
      ),
    },
  });
  return { field: ref, widgets: [ref] };
}

/** Background and border shared by every boxed appearance. */
function frame(cs: ContentStream, w: number, h: number): ContentStream {
  return cs
    .fillColor(BACKGROUND)
    .strokeColor(BORDER)
    .lineWidth(1)
    .rect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
    .fillAndStroke();
}

/** `/Tx BMC … EMC`: the marked section a viewer replaces while the field is edited. */
function textAppearance(
  w: number,
  h: number,
  text: string,
  size: number,
  quadding: number,
  field: PendingFormField,
): ContentStream {
  const font = resolveFont("helvetica", false, false);
  const cs = frame(new ContentStream(), w, h);
  if (field.kind === "choice") {
    // A small chevron, so a printed dropdown still reads as one.
    const s = Math.min(h * 0.25, 4);
    const cx = w - PADDING - 2 - s;
    cs.fillColor(BORDER)
      .moveTo(cx - s, h / 2 + s / 2)
      .lineTo(cx + s, h / 2 + s / 2)
      .lineTo(cx, h / 2 - s / 2)
      .closePath()
      .fill();
    w -= 2 * s + PADDING + 2;
  }
  const inner = w - 2 * PADDING - 2;
  const multiline = field.kind === "text" && (field.flags & FF_MULTILINE) !== 0;
  const lines = multiline
    ? wrapLines(text, font, size, inner).map((l) => l.text)
    : [text.replace(/\r?\n|\r/g, " ")];
  const step = size * 1.15;
  // Single line: the cap height centred in the box. Multiline: from the top.
  let baseline = multiline
    ? h - PADDING - 1 - (font.ascent * size) / 1000
    : (h - (font.capHeight * size) / 1000) / 2;
  cs.raw("/Tx BMC")
    .save()
    .rect(1, 1, Math.max(0, w - 2), Math.max(0, h - 2))
    .clip()
    .fillColor(INK);
  for (const line of lines) {
    if (line !== "") {
      const free = inner - font.widthOf(line, size);
      const dx = quadding === 1 ? free / 2 : quadding === 2 ? free : 0;
      cs.text(font.encode(line), PADDING + 1 + dx, baseline, "Helv", size);
    }
    baseline -= step;
  }
  return cs.restore().raw("EMC");
}

/** A checkbox: the frame, plus a stroked tick when on. */
function checkAppearance(w: number, h: number, on: boolean): ContentStream {
  const cs = frame(new ContentStream(), w, h);
  if (on) {
    const s = Math.min(w, h);
    cs.strokeColor(INK)
      .lineWidth(s * 0.12)
      .raw("1 J 1 j")
      .moveTo(w / 2 - s * 0.28, h / 2 + s * 0.02)
      .lineTo(w / 2 - s * 0.08, h / 2 - s * 0.2)
      .lineTo(w / 2 + s * 0.3, h / 2 + s * 0.24)
      .stroke();
  }
  return cs;
}

/** A radio button: a framed circle, plus a filled dot when on. */
function radioAppearance(size: number, on: boolean): ContentStream {
  const c = size / 2;
  const cs = circle(
    new ContentStream().fillColor(BACKGROUND).strokeColor(BORDER).lineWidth(1),
    c,
    c - 0.5,
  ).fillAndStroke();
  if (on) circle(cs.fillColor(INK), c, size * 0.22).fill();
  return cs;
}

/** A closed circle path of radius `r` around (c, c). */
function circle(cs: ContentStream, c: number, r: number): ContentStream {
  const k = r * KAPPA;
  return cs
    .moveTo(c + r, c)
    .curveTo(c + r, c + k, c + k, c + r, c, c + r)
    .curveTo(c - k, c + r, c - r, c + k, c - r, c)
    .curveTo(c - r, c - k, c - k, c - r, c, c - r)
    .curveTo(c + k, c - r, c + r, c - k, c + r, c)
    .closePath();
}
