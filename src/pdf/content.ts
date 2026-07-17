import { escapeString, fmtNumber, latin1Bytes } from "./objects";
import type { RGB } from "../types/index";

/**
 * ContentStream — builder for PDF page content operators.
 *
 * Works in native PDF coordinates (origin bottom-left, y grows upward).
 * The document layer converts from user coordinates before calling in.
 * Output is latin1 text; text-showing operators receive pre-encoded
 * WinAnsi bytes as a latin1 string.
 */
export class ContentStream {
  private parts: string[] = [];

  private n(v: number): string {
    return fmtNumber(v);
  }

  save(): this {
    this.parts.push("q");
    return this;
  }

  restore(): this {
    this.parts.push("Q");
    return this;
  }

  fillColor(c: RGB): this {
    this.parts.push(`${this.n(c.r)} ${this.n(c.g)} ${this.n(c.b)} rg`);
    return this;
  }

  strokeColor(c: RGB): this {
    this.parts.push(`${this.n(c.r)} ${this.n(c.g)} ${this.n(c.b)} RG`);
    return this;
  }

  lineWidth(w: number): this {
    this.parts.push(`${this.n(w)} w`);
    return this;
  }

  moveTo(x: number, y: number): this {
    this.parts.push(`${this.n(x)} ${this.n(y)} m`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.parts.push(`${this.n(x)} ${this.n(y)} l`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.parts.push(`${this.n(x)} ${this.n(y)} ${this.n(w)} ${this.n(h)} re`);
    return this;
  }

  /** Cubic Bézier curve from the current point. */
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    this.parts.push(
      `${this.n(x1)} ${this.n(y1)} ${this.n(x2)} ${this.n(y2)} ${this.n(x3)} ${this.n(y3)} c`,
    );
    return this;
  }

  closePath(): this {
    this.parts.push("h");
    return this;
  }

  /** Use the current path as a clipping path (non-zero winding), ending it. */
  clip(): this {
    this.parts.push("W n");
    return this;
  }

  /** Activate a named ExtGState resource (e.g. for constant alpha). */
  setGState(res: string): this {
    this.parts.push(`/${res} gs`);
    return this;
  }

  /** Concatenate a transformation matrix to the CTM. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.parts.push(
      `${this.n(a)} ${this.n(b)} ${this.n(c)} ${this.n(d)} ${this.n(e)} ${this.n(f)} cm`,
    );
    return this;
  }

  stroke(): this {
    this.parts.push("S");
    return this;
  }

  fill(): this {
    this.parts.push("f");
    return this;
  }

  fillAndStroke(): this {
    this.parts.push("B");
    return this;
  }

  /**
   * Show one line of text.
   * @param encoded WinAnsi-encoded bytes as a latin1 string (one char = one byte)
   * @param x,y baseline position in PDF space
   * @param charSpace extra spacing per character code in points (Tc)
   */
  text(encoded: string, x: number, y: number, fontRes: string, size: number, charSpace = 0): this {
    // Tc survives ET (text state is graphics state) — reset it in-block.
    const tc = charSpace !== 0 ? `${this.n(charSpace)} Tc ` : "";
    const reset = charSpace !== 0 ? " 0 Tc" : "";
    this.parts.push(
      `BT /${fontRes} ${this.n(size)} Tf ${tc}${this.n(x)} ${this.n(y)} Td (${escapeString(encoded)}) Tj${reset} ET`,
    );
    return this;
  }

  /**
   * Show one line as a TJ array: strings interleaved with position
   * adjustments in 1/1000 em (positive moves left — pass negative values
   * to widen gaps, e.g. for justified text).
   */
  textTJ(parts: (string | number)[], x: number, y: number, fontRes: string, size: number, charSpace = 0): this {
    const tc = charSpace !== 0 ? `${this.n(charSpace)} Tc ` : "";
    const reset = charSpace !== 0 ? " 0 Tc" : "";
    const arr = parts
      .map((p) => (typeof p === "number" ? this.n(p) : `(${escapeString(p)})`))
      .join(" ");
    this.parts.push(
      `BT /${fontRes} ${this.n(size)} Tf ${tc}${this.n(x)} ${this.n(y)} Td [${arr}] TJ${reset} ET`,
    );
    return this;
  }

  /** Draw an image XObject scaled to w×h at (x, y) = bottom-left corner. */
  image(imageRes: string, x: number, y: number, w: number, h: number): this {
    this.parts.push(`q ${this.n(w)} 0 0 ${this.n(h)} ${this.n(x)} ${this.n(y)} cm /${imageRes} Do Q`);
    return this;
  }

  /** Raw operator escape hatch for extensions. */
  raw(ops: string): this {
    this.parts.push(ops);
    return this;
  }

  /** Current position in the operator list, for later insertAt(). */
  mark(): number {
    return this.parts.length;
  }

  /**
   * Insert operators at a previously taken mark() — used to paint
   * backgrounds behind content whose height was unknown when it started.
   */
  insertAt(mark: number, ops: ContentStream): void {
    this.parts.splice(mark, 0, ...ops.parts);
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  toBytes(): Uint8Array {
    return latin1Bytes(this.parts.join("\n"));
  }
}
