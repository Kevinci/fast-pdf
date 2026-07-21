import type { ContentStream } from "../pdf/content";
import { parseColor, type RGB } from "../types/index";
import type { SvgNode } from "./parse";
import { parsePath, type PathSeg } from "./path";

/** 2-D affine matrix [a, b, c, d, e, f]; maps (x,y) → (ax+cy+e, bx+dy+f). */
export type Mat = [number, number, number, number, number, number];

/** Callbacks the document supplies so the renderer can reach its engine. */
export interface SvgContext {
  content: ContentStream;
  /** ExtGState resource name for a constant alpha. */
  gsRes(alpha: number): string;
  /** Draw one upright text line; the anchor point is already in PDF space. */
  drawText(text: string, pdfX: number, pdfY: number, sizePt: number, fill: RGB, anchor: "start" | "middle" | "end"): void;
  /** Value substituted for `currentColor`. */
  currentColor: RGB;
}

/** The SVG's intrinsic geometry, for sizing the target box. */
export interface SvgViewport {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
}

const KAPPA = 0.5522847498;

// ── matrix helpers ─────────────────────────────────────────────────────

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Compose so the result applies `n` first, then `m`. */
function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor of a matrix (for stroke width and font size). */
function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

const NUM = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

function numbers(s: string): number[] {
  return (s.match(NUM) ?? []).map(Number);
}

export function parseTransform(value: string): Mat {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const args = numbers(match[2]!);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    switch (match[1]) {
      case "matrix": m = mul(m, [a, b, c, d, e, f]); break;
      case "translate": m = mul(m, [1, 0, 0, 1, a, args.length > 1 ? b : 0]); break;
      case "scale": m = mul(m, [a, 0, 0, args.length > 1 ? b : a, 0, 0]); break;
      case "rotate": {
        const rad = (a * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = args.length > 1 ? b : 0, cy = args.length > 1 ? c : 0;
        m = mul(m, [1, 0, 0, 1, cx, cy]);
        m = mul(m, [cos, sin, -sin, cos, 0, 0]);
        m = mul(m, [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX": m = mul(m, [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0]); break;
      case "skewY": m = mul(m, [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0]); break;
    }
  }
  return m;
}

// ── colours ────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", lime: "#00ff00",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", aqua: "#00ffff", magenta: "#ff00ff",
  fuchsia: "#ff00ff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  olive: "#808000", navy: "#000080", teal: "#008080", purple: "#800080", orange: "#ffa500",
  pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", indigo: "#4b0082", violet: "#ee82ee",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
  dimgray: "#696969", steelblue: "#4682b4", tomato: "#ff6347", crimson: "#dc143c",
  darkgreen: "#006400", lightblue: "#add8e6", transparent: "none",
};

/** Resolve an SVG paint value to an RGB colour, or null for "none"/invalid. */
function resolveColor(value: string, currentColor: RGB): RGB | null {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "none" || v === "transparent") return null;
  if (v === "currentcolor") return currentColor;
  const rgb = v.startsWith("rgb")
    ? numbers(v)
    : null;
  if (rgb) {
    const pct = v.includes("%");
    const to255 = (n: number): number => (pct ? (n / 100) * 255 : n);
    return parseColor({ r: to255(rgb[0] ?? 0), g: to255(rgb[1] ?? 0), b: to255(rgb[2] ?? 0) });
  }
  const named = NAMED[v];
  if (named === "none") return null;
  try {
    return parseColor(named ?? v);
  } catch {
    return null;
  }
}

// ── style ──────────────────────────────────────────────────────────────

interface Style {
  fill: RGB | null;
  stroke: RGB | null;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  evenOdd: boolean;
  fontSize: number;
}

const INITIAL: Style = {
  fill: { r: 0, g: 0, b: 0 },
  stroke: null,
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  evenOdd: false,
  fontSize: 16,
};

/** Read a presentation property from attributes or the inline `style`. */
function prop(node: SvgNode, style: Record<string, string>, name: string): string | undefined {
  return style[name] ?? node.attrs[name];
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function inlineStyle(node: SvgNode): Record<string, string> {
  const s = node.attrs["style"];
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const decl of s.split(";")) {
    const idx = decl.indexOf(":");
    if (idx > 0) out[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
  }
  return out;
}

function resolveStyle(node: SvgNode, parent: Style, currentColor: RGB): Style {
  const s = inlineStyle(node);
  const fillRaw = prop(node, s, "fill");
  const strokeRaw = prop(node, s, "stroke");
  const fill = fillRaw === undefined ? parent.fill : resolveColor(fillRaw, currentColor);
  const stroke = strokeRaw === undefined ? parent.stroke : resolveColor(strokeRaw, currentColor);
  return {
    fill,
    stroke,
    strokeWidth: num(prop(node, s, "stroke-width"), parent.strokeWidth),
    fillOpacity: num(prop(node, s, "fill-opacity"), parent.fillOpacity),
    strokeOpacity: num(prop(node, s, "stroke-opacity"), parent.strokeOpacity),
    opacity: num(prop(node, s, "opacity"), 1), // not inherited; applies per element/group
    evenOdd: (prop(node, s, "fill-rule") ?? (parent.evenOdd ? "evenodd" : "nonzero")) === "evenodd",
    fontSize: num(prop(node, s, "font-size"), parent.fontSize),
  };
}

// ── shapes → path segments (in SVG user space) ──────────────────────────

function ellipseSegs(cx: number, cy: number, rx: number, ry: number): PathSeg[] {
  const kx = KAPPA * rx, ky = KAPPA * ry;
  return [
    { op: "M", x: cx + rx, y: cy },
    { op: "C", x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { op: "C", x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { op: "C", x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { op: "C", x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { op: "Z" },
  ];
}

function roundedRectSegs(x: number, y: number, w: number, h: number, rx: number, ry: number): PathSeg[] {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) {
    return [
      { op: "M", x, y },
      { op: "L", x: x + w, y },
      { op: "L", x: x + w, y: y + h },
      { op: "L", x, y: y + h },
      { op: "Z" },
    ];
  }
  const kx = KAPPA * rx, ky = KAPPA * ry;
  return [
    { op: "M", x: x + rx, y },
    { op: "L", x: x + w - rx, y },
    { op: "C", x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
    { op: "L", x: x + w, y: y + h - ry },
    { op: "C", x1: x + w, y1: y + h - ry + ky, x2: x + w - rx + kx, y2: y + h, x: x + w - rx, y: y + h },
    { op: "L", x: x + rx, y: y + h },
    { op: "C", x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x, y: y + h - ry },
    { op: "L", x, y: y + ry },
    { op: "C", x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y },
    { op: "Z" },
  ];
}

function pointsSegs(points: number[], close: boolean): PathSeg[] {
  const segs: PathSeg[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    segs.push({ op: i === 0 ? "M" : "L", x: points[i]!, y: points[i + 1]! });
  }
  if (close) segs.push({ op: "Z" });
  return segs;
}

// ── emit & paint ─────────────────────────────────────────────────────────

function emitPath(content: ContentStream, segs: PathSeg[], m: Mat): void {
  for (const seg of segs) {
    if (seg.op === "M") {
      const [x, y] = apply(m, seg.x, seg.y);
      content.moveTo(x, y);
    } else if (seg.op === "L") {
      const [x, y] = apply(m, seg.x, seg.y);
      content.lineTo(x, y);
    } else if (seg.op === "C") {
      const [x1, y1] = apply(m, seg.x1, seg.y1);
      const [x2, y2] = apply(m, seg.x2, seg.y2);
      const [x, y] = apply(m, seg.x, seg.y);
      content.curveTo(x1, y1, x2, y2, x, y);
    } else {
      content.closePath();
    }
  }
}

function paint(ctx: SvgContext, style: Style, m: Mat, strokable: boolean): void {
  const { content } = ctx;
  const fill = style.fill;
  const stroke = strokable ? style.stroke : null;
  if (!fill && !stroke) {
    content.raw("n"); // discard the path without painting
    return;
  }
  const fillAlpha = clamp01(style.opacity * style.fillOpacity);
  const strokeAlpha = clamp01(style.opacity * style.strokeOpacity);
  const alpha = fill ? fillAlpha : strokeAlpha;
  const needAlpha = alpha < 1;
  if (needAlpha) content.save().setGState(ctx.gsRes(alpha));
  if (fill) content.fillColor(fill);
  if (stroke) content.strokeColor(stroke).lineWidth(style.strokeWidth * scaleOf(m));
  if (fill && stroke) content.raw(style.evenOdd ? "B*" : "B");
  else if (fill) content.raw(style.evenOdd ? "f*" : "f");
  else content.raw("S");
  if (needAlpha) content.restore();
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── tree walk ────────────────────────────────────────────────────────────

function renderNode(node: SvgNode, m: Mat, parent: Style, ctx: SvgContext): void {
  if (node.attrs["display"] === "none") return;
  const local = node.attrs["transform"] ? mul(m, parseTransform(node.attrs["transform"])) : m;
  const style = resolveStyle(node, parent, ctx.currentColor);
  const a = node.attrs;

  switch (node.tag) {
    case "g":
    case "svg":
    case "a":
      for (const child of node.children) renderNode(child, local, style, ctx);
      return;
    case "rect": {
      const rx = a["rx"] !== undefined ? parseFloat(a["rx"]) : a["ry"] !== undefined ? parseFloat(a["ry"]) : 0;
      const ry = a["ry"] !== undefined ? parseFloat(a["ry"]) : rx;
      emitPath(ctx.content, roundedRectSegs(num(a["x"], 0), num(a["y"], 0), num(a["width"], 0), num(a["height"], 0), rx, ry), local);
      paint(ctx, style, local, true);
      return;
    }
    case "circle": {
      const r = num(a["r"], 0);
      if (r > 0) {
        emitPath(ctx.content, ellipseSegs(num(a["cx"], 0), num(a["cy"], 0), r, r), local);
        paint(ctx, style, local, true);
      }
      return;
    }
    case "ellipse": {
      const rx = num(a["rx"], 0), ry = num(a["ry"], 0);
      if (rx > 0 && ry > 0) {
        emitPath(ctx.content, ellipseSegs(num(a["cx"], 0), num(a["cy"], 0), rx, ry), local);
        paint(ctx, style, local, true);
      }
      return;
    }
    case "line": {
      emitPath(ctx.content, [
        { op: "M", x: num(a["x1"], 0), y: num(a["y1"], 0) },
        { op: "L", x: num(a["x2"], 0), y: num(a["y2"], 0) },
      ], local);
      paint(ctx, { ...style, fill: null }, local, true);
      return;
    }
    case "polygon":
    case "polyline": {
      const pts = numbers(a["points"] ?? "");
      if (pts.length >= 4) {
        emitPath(ctx.content, pointsSegs(pts, node.tag === "polygon"), local);
        paint(ctx, node.tag === "polyline" ? { ...style, fill: style.fill } : style, local, true);
      }
      return;
    }
    case "path": {
      if (a["d"]) {
        emitPath(ctx.content, parsePath(a["d"]), local);
        paint(ctx, style, local, true);
      }
      return;
    }
    case "text": {
      renderText(node, local, style, ctx);
      return;
    }
    default:
      // Unknown element: still descend (covers wrappers we don't model).
      for (const child of node.children) renderNode(child, local, style, ctx);
      return;
  }
}

function gatherText(node: SvgNode): string {
  let out = node.text;
  for (const child of node.children) out += gatherText(child);
  return out;
}

function renderText(node: SvgNode, m: Mat, style: Style, ctx: SvgContext): void {
  const text = gatherText(node).replace(/\s+/g, " ").trim();
  if (text === "" || !style.fill) return;
  const x = num(node.attrs["x"], 0);
  const y = num(node.attrs["y"], 0);
  const [px, py] = apply(m, x, y);
  const anchorRaw = node.attrs["text-anchor"];
  const anchor = anchorRaw === "middle" ? "middle" : anchorRaw === "end" ? "end" : "start";
  ctx.drawText(text, px, py, style.fontSize * scaleOf(m), style.fill, anchor);
}

// ── public entry ───────────────────────────────────────────────────────

/** Intrinsic geometry: from `width`/`height` and/or `viewBox`. */
export function viewport(svg: SvgNode): SvgViewport {
  const vbRaw = svg.attrs["viewbox"];
  const vb = vbRaw ? numbers(vbRaw) : null;
  const w = svg.attrs["width"] !== undefined ? parseFloat(svg.attrs["width"]) : NaN;
  const h = svg.attrs["height"] !== undefined ? parseFloat(svg.attrs["height"]) : NaN;
  let viewBox: [number, number, number, number];
  if (vb && vb.length === 4) viewBox = [vb[0]!, vb[1]!, vb[2]!, vb[3]!];
  else viewBox = [0, 0, Number.isFinite(w) ? w : 100, Number.isFinite(h) ? h : 100];
  return {
    width: Number.isFinite(w) ? w : viewBox[2],
    height: Number.isFinite(h) ? h : viewBox[3],
    viewBox,
  };
}

/** Render an SVG tree with the given SVG-space → PDF-space base matrix. */
export function renderSvg(svg: SvgNode, base: Mat, ctx: SvgContext): void {
  ctx.content.save();
  for (const child of svg.children) renderNode(child, base, INITIAL, ctx);
  ctx.content.restore();
}
