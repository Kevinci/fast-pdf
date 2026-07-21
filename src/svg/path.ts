/**
 * SVG path data (`d`) → normalized absolute segments.
 *
 * Every command is reduced to one of three primitives — move, line and
 * cubic Bézier — plus close, matching what a PDF content stream can draw.
 * Quadratic (Q/T) curves are elevated to cubic; elliptical arcs (A) are
 * split into ≤90° arcs and approximated by cubic Béziers.
 */
export type PathSeg =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

const NUM_RE = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < d.length) {
    const c = d[i]!;
    if (/[a-zA-Z]/.test(c)) {
      tokens.push(c);
      i++;
    } else if (/[\s,]/.test(c)) {
      i++;
    } else {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(d);
      if (!m || m.index !== i) {
        i++; // skip an unexpected character
        continue;
      }
      tokens.push(parseFloat(m[0]));
      i = NUM_RE.lastIndex;
    }
  }
  return tokens;
}

export function parsePath(d: string): PathSeg[] {
  const tokens = tokenize(d);
  const segs: PathSeg[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Last control point of the previous C/S (for S) or Q/T (for T).
  let lastC: { x: number; y: number } | null = null;
  let lastQ: { x: number; y: number } | null = null;
  let cmd = "";

  const num = (): number => {
    const t = tokens[i++];
    return typeof t === "number" ? t : NaN;
  };
  const hasNum = (): boolean => typeof tokens[i] === "number";

  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number): void => {
    segs.push({ op: "C", x1, y1, x2, y2, x: ex, y: ey });
    lastC = { x: x2, y: y2 };
    x = ex;
    y = ey;
  };

  while (i < tokens.length) {
    if (typeof tokens[i] === "string") {
      cmd = tokens[i] as string;
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    const abs = cmd.toUpperCase();
    const dx = rel ? x : 0;
    const dy = rel ? y : 0;

    switch (abs) {
      case "M": {
        x = num() + dx;
        y = num() + dy;
        segs.push({ op: "M", x, y });
        startX = x;
        startY = y;
        lastC = lastQ = null;
        cmd = rel ? "l" : "L"; // subsequent pairs are implicit line-tos
        break;
      }
      case "L": {
        x = num() + dx;
        y = num() + dy;
        segs.push({ op: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "H": {
        x = num() + dx;
        segs.push({ op: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "V": {
        y = num() + dy;
        segs.push({ op: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "C": {
        const x1 = num() + dx, y1 = num() + dy, x2 = num() + dx, y2 = num() + dy, ex = num() + dx, ey = num() + dy;
        cubic(x1, y1, x2, y2, ex, ey);
        lastQ = null;
        break;
      }
      case "S": {
        const [x1, y1] = reflect(lastC, x, y);
        const x2 = num() + dx, y2 = num() + dy, ex = num() + dx, ey = num() + dy;
        cubic(x1, y1, x2, y2, ex, ey);
        lastQ = null;
        break;
      }
      case "Q": {
        const qx = num() + dx, qy = num() + dy, ex = num() + dx, ey = num() + dy;
        quadratic(cubic, x, y, qx, qy, ex, ey);
        lastQ = { x: qx, y: qy };
        break;
      }
      case "T": {
        const [qx, qy] = reflect(lastQ, x, y);
        const ex = num() + dx, ey = num() + dy;
        quadratic(cubic, x, y, qx, qy, ex, ey);
        lastQ = { x: qx, y: qy };
        break;
      }
      case "A": {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), ex = num() + dx, ey = num() + dy;
        arc(segs, x, y, rx, ry, rot, large !== 0, sweep !== 0, ex, ey);
        x = ex;
        y = ey;
        lastC = lastQ = null;
        break;
      }
      case "Z": {
        segs.push({ op: "Z" });
        x = startX;
        y = startY;
        lastC = lastQ = null;
        break;
      }
      default:
        return segs; // unknown command — stop
    }
    // Guard against malformed input that consumed a NaN.
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (abs !== "M" && abs !== "L" && abs !== "H" && abs !== "V" && abs !== "C" &&
        abs !== "S" && abs !== "Q" && abs !== "T" && abs !== "A" && abs !== "Z") break;
    // Continue with repeated coordinate sets unless the next token is a command.
    if (abs === "Z" && !hasNum()) continue;
  }
  return segs;
}

type CubicFn = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => void;

/** Reflect the previous control point about the current point (for S/T). */
function reflect(last: { x: number; y: number } | null, cx: number, cy: number): [number, number] {
  return last ? [2 * cx - last.x, 2 * cy - last.y] : [cx, cy];
}

/** Elevate a quadratic Bézier to a cubic one. */
function quadratic(cubic: CubicFn, x0: number, y0: number, qx: number, qy: number, ex: number, ey: number): void {
  cubic(
    x0 + (2 / 3) * (qx - x0),
    y0 + (2 / 3) * (qy - y0),
    ex + (2 / 3) * (qx - ex),
    ey + (2 / 3) * (qy - ey),
    ex,
    ey,
  );
}

/** Endpoint-parameterised elliptical arc → cubic Bézier segments (SVG impl. notes F.6). */
function arc(
  segs: PathSeg[],
  x0: number, y0: number,
  rx: number, ry: number,
  rotDeg: number, large: boolean, sweep: boolean,
  x: number, y: number,
): void {
  if (rx === 0 || ry === 0) {
    segs.push({ op: "L", x, y });
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;

  // Correct out-of-range radii.
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = large !== sweep ? 1 : -1;
  const numer = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, numer / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);

  let ang = theta1;
  for (let s = 0; s < segments; s++) {
    const nextAng = ang + step;
    const cosA = Math.cos(ang), sa = Math.sin(ang);
    const cosB = Math.cos(nextAng), sb = Math.sin(nextAng);

    const p1x = cx + rx * cos * cosA - ry * sin * sa;
    const p1y = cy + rx * sin * cosA + ry * cos * sa;
    const p2x = cx + rx * cos * cosB - ry * sin * sb;
    const p2y = cy + rx * sin * cosB + ry * cos * sb;

    const d1x = -rx * cos * sa - ry * sin * cosA;
    const d1y = -rx * sin * sa + ry * cos * cosA;
    const d2x = -rx * cos * sb - ry * sin * cosB;
    const d2y = -rx * sin * sb + ry * cos * cosB;

    segs.push({
      op: "C",
      x1: p1x + t * d1x,
      y1: p1y + t * d1y,
      x2: p2x - t * d2x,
      y2: p2y - t * d2y,
      x: p2x,
      y: p2y,
    });
    ang = nextAng;
  }
}
