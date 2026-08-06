import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import { makePng, makeTTF } from "./helpers";

const raw = () => new PDFDocument({ compress: false });

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

describe("opacity", () => {
  it("applies a constant alpha to a filled rect", async () => {
    const pdf = raw();
    pdf.rect(10, 10, 50, 50, { fill: "#ff0000", opacity: 0.4 });
    const text = await rendered(pdf);
    expect(text).toMatch(/\/GS0 gs/);
    expect(text).toContain("/ca 0.4");
    expect(text).toContain("/CA 0.4");
  });

  it("resets the alpha afterwards so later shapes stay opaque", async () => {
    const pdf = raw();
    pdf.rect(10, 10, 50, 50, { fill: "#ff0000", opacity: 0.4 });
    pdf.rect(80, 10, 50, 50, { fill: "#00ff00" });
    const text = await rendered(pdf);
    // The alpha is scoped by q/Q around the whole shape, so the second rect
    // inherits nothing: exactly one gs, and it is balanced by a restore.
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)![1]!;
    expect((stream.match(/gs/g) ?? []).length).toBe(1);
    expect(stream.indexOf("Q")).toBeGreaterThan(stream.indexOf("/GS0 gs"));
    expect(stream.indexOf("0 1 0 rg")).toBeGreaterThan(stream.indexOf("Q"));
  });

  it("sets the alpha before the path begins, not inside the path object", async () => {
    const pdf = raw();
    pdf.rect(10, 10, 50, 50, { fill: "#ff0000", opacity: 0.4 });
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(await rendered(pdf))![1]!;
    // PDF's graphics object model allows only construction and painting
    // operators between `re` and `f` — no `gs`, no colour operators.
    expect(stream).toMatch(/q\n\/GS0 gs\n1 0 0 rg\n[\d. ]+re\nf\nQ/);
  });

  it("emits nothing extra when opacity is 1 or omitted", async () => {
    const pdf = raw();
    pdf.rect(10, 10, 50, 50, { fill: "#ff0000", opacity: 1 });
    pdf.circle(100, 100, 20, { fill: "#0000ff" });
    const text = await rendered(pdf);
    expect(text).not.toContain("ExtGState");
  });

  it("works on circles, lines, text, images and svg", async () => {
    const png = await makePng(2, 2, 2, [255, 0, 0]);
    for (const draw of [
      (d: PDFDocument) => d.circle(50, 50, 20, { fill: "#000", opacity: 0.5 }),
      (d: PDFDocument) => d.ellipse(50, 50, 20, 10, { stroke: "#000", opacity: 0.5 }),
      (d: PDFDocument) => d.line(0, 0, 10, 10, { opacity: 0.5 }),
      (d: PDFDocument) => d.text("halbdurchsichtig", { opacity: 0.5 }),
      (d: PDFDocument) => d.image(png, { width: 20, opacity: 0.5 }),
      (d: PDFDocument) =>
        d.svg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', {
          width: 20,
          opacity: 0.5,
        }),
    ]) {
      const pdf = raw();
      draw(pdf);
      const text = await rendered(pdf);
      expect(text).toContain("/ca 0.5");
      expect(text).toContain("gs");
    }
  });

  it("clamps out-of-range values instead of emitting nonsense", async () => {
    const pdf = raw();
    pdf.rect(0, 0, 10, 10, { fill: "#000", opacity: -3 });
    const text = await rendered(pdf);
    expect(text).toContain("/ca 0");
    expect(text).not.toContain("-3");
  });

  it("makes a container background translucent", async () => {
    const pdf = raw();
    pdf.container({ width: 200, background: "#123456", opacity: 0.25, padding: 8 }, (d) =>
      d.text("Karte"),
    );
    const text = await rendered(pdf);
    expect(text).toContain("/ca 0.25");
  });
});

describe("clip()", () => {
  it("clips drawing to a rectangle", async () => {
    const pdf = raw();
    pdf.clip({ x: 10, y: 10, width: 100, height: 100 }, (d) => {
      d.rect(0, 0, 500, 500, { fill: "#ff0000" });
    });
    const text = await rendered(pdf);
    expect(text).toContain("W n");
    expect(text).toMatch(/q\n/);
    expect(text).toMatch(/\nQ/);
  });

  it("rounds the clip with a radius (Bézier corners, not a plain re)", async () => {
    const square = raw();
    square.clip({ x: 0, y: 0, width: 100, height: 100 }, (d) =>
      d.rect(0, 0, 100, 100, { fill: "#000" }),
    );
    const round = raw();
    round.clip({ x: 0, y: 0, width: 100, height: 100, radius: 50 }, (d) =>
      d.rect(0, 0, 100, 100, { fill: "#000" }),
    );
    const squareText = await rendered(square);
    const roundText = await rendered(round);
    expect((squareText.match(/ c\n/g) ?? []).length).toBe(0);
    expect((roundText.match(/ c\n/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("restores the graphics state even when the callback throws", async () => {
    const pdf = raw();
    expect(() =>
      pdf.clip({ x: 0, y: 0, width: 10, height: 10 }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const text = await rendered(pdf);
    expect((text.match(/\bq\b/g) ?? []).length).toBe((text.match(/\bQ\b/g) ?? []).length);
  });

  it("caps the radius at half the shorter side", async () => {
    const pdf = raw();
    // Radius 999 on a 40×20 box must not produce a self-intersecting path.
    pdf.clip({ x: 0, y: 0, width: 40, height: 20, radius: 999 }, (d) =>
      d.rect(0, 0, 40, 20, { fill: "#000" }),
    );
    const text = await rendered(pdf);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("999");
  });
});

describe("image radius / shape", () => {
  it("clips a square image into a circle without Canvas", async () => {
    const png = await makePng(8, 8, 6, [255, 0, 0, 255]);
    const pdf = raw();
    pdf.image(png, { width: 80, height: 80, shape: "circle" });
    const text = await rendered(pdf);
    expect(text).toContain("W n"); // a clip path was set
    expect((text.match(/ c\n/g) ?? []).length).toBeGreaterThanOrEqual(4); // rounded corners
  });

  it("rounds corners with an explicit radius", async () => {
    const png = await makePng(4, 4, 2, [0, 128, 255]);
    const pdf = raw();
    pdf.image(png, { width: 60, height: 60, radius: 12 });
    const text = await rendered(pdf);
    expect(text).toContain("W n");
  });

  it("adds no clip path when neither radius nor fit asks for one", async () => {
    const png = await makePng(4, 4, 2, [0, 128, 255]);
    const pdf = raw();
    pdf.image(png, { width: 60, height: 60 });
    expect(await rendered(pdf)).not.toContain("W n");
  });

  it("combines a circular clip with cover fit for a non-square source", async () => {
    const png = await makePng(16, 4, 2, [10, 20, 30]);
    const pdf = raw();
    pdf.image(png, { width: 50, height: 50, fit: "cover", shape: "circle" });
    const text = await rendered(pdf);
    expect(text).toContain("W n");
    expect(text).not.toContain("NaN");
  });

  it("still positions absolutely when y is given", async () => {
    const png = await makePng(4, 4, 2, [0, 0, 0]);
    const pdf = raw();
    const y = pdf.y;
    pdf.image(png, { x: 100, y: 200, width: 40, height: 40, shape: "circle" });
    expect(pdf.y).toBe(y);
    expect(pdf.lastBlockHeight).toBe(40);
  });
});

describe("rotated text", () => {
  it("emits a rotation matrix", async () => {
    const pdf = raw();
    pdf.text("Rückenbeschriftung", { x: 30, y: 400, rotate: -90 });
    const text = await rendered(pdf);
    expect(text).toContain(" cm");
    expect(text).toContain("Rückenbeschriftung".replace("ü", "ü"));
  });

  it("draws upright text without a transform", async () => {
    const pdf = raw();
    pdf.text("gerade", { x: 30, y: 400 });
    expect(await rendered(pdf)).not.toContain(" cm");
  });

  it("advances the flow cursor by the unrotated block height", () => {
    const pdf = raw();
    const y = pdf.y;
    pdf.text("gedreht", { rotate: 45, size: 10, lineHeight: 1.2 });
    expect(pdf.y - y).toBeCloseTo(12, 6);
  });
});

describe("synthetic italic", () => {
  it("slants text when the family has no italic cut", async () => {
    const pdf = raw();
    pdf.registerFont(makeTTF(), { family: "solo" });
    pdf.text("AB", { font: "solo", italic: true });
    const text = await rendered(pdf);
    expect(text).toMatch(/1 0 0\.2\d* 1 .* Tm/); // tan(12°) ≈ 0.2126
  });

  it("uses the real cut when one is registered", async () => {
    const pdf = raw();
    pdf.registerFont(makeTTF(), { family: "pair" });
    pdf.registerFont(makeTTF(), { family: "pair", italic: true });
    pdf.text("AB", { font: "pair", italic: true });
    expect(await rendered(pdf)).not.toContain(" Tm");
  });

  it("leaves the standard 14 alone (they ship real obliques)", async () => {
    const pdf = raw();
    pdf.text("AB", { italic: true });
    expect(await rendered(pdf)).not.toContain(" Tm");
  });
});
