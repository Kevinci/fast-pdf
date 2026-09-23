import { describe, expect, it } from "vitest";
import { parseCssColor } from "../src/types/css-color";
import { parseColor } from "../src/types/index";
import { FastPDFError } from "../src/errors";

/** Compare against 0–255 values, the way CSS and design tools quote them. */
function rgb255(input: string): [number, number, number] {
  const parsed = parseCssColor(input);
  if (!parsed) throw new Error(`did not parse: ${input}`);
  return [
    Math.round(parsed.rgb.r * 255),
    Math.round(parsed.rgb.g * 255),
    Math.round(parsed.rgb.b * 255),
  ];
}

/** Perceptual spaces round-trip with a little slack; 2/255 is invisible. */
function expectClose(input: string, expected: [number, number, number]): void {
  const actual = rgb255(input);
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(actual[i]! - expected[i]!),
      `${input} → ${actual.join(",")}`,
    ).toBeLessThanOrEqual(2);
  }
}

describe("parseCssColor — syntaxes a browser hands back", () => {
  it("reads legacy and modern rgb()", () => {
    expect(rgb255("rgb(255, 0, 0)")).toEqual([255, 0, 0]);
    expect(rgb255("rgb(16 32 48)")).toEqual([16, 32, 48]);
    expect(rgb255("rgb(100% 0% 50%)")).toEqual([255, 0, 128]);
  });

  it("reads alpha from rgba() and the slash form", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0.25)")?.alpha).toBeCloseTo(0.25, 5);
    expect(parseCssColor("rgb(0 0 0 / 50%)")?.alpha).toBeCloseTo(0.5, 5);
    expect(parseCssColor("#00000080")?.alpha).toBeCloseTo(0.502, 2);
  });

  it("treats transparent as a real color with zero alpha", () => {
    const parsed = parseCssColor("transparent");
    expect(parsed).not.toBeNull();
    expect(parsed!.alpha).toBe(0);
  });

  it("reads hex in every length", () => {
    expect(rgb255("#f00")).toEqual([255, 0, 0]);
    expect(rgb255("#ff0000")).toEqual([255, 0, 0]);
    expect(rgb255("663399")).toEqual([102, 51, 153]);
  });

  it("knows the CSS named colors", () => {
    expect(rgb255("rebeccapurple")).toEqual([102, 51, 153]);
    expect(rgb255("white")).toEqual([255, 255, 255]);
    expect(rgb255("darkslategrey")).toEqual([47, 79, 79]);
  });

  it("converts hsl() and hwb()", () => {
    expect(rgb255("hsl(0, 100%, 50%)")).toEqual([255, 0, 0]);
    expect(rgb255("hsl(210 50% 40%)")).toEqual([51, 102, 153]);
    expect(rgb255("hwb(0 0% 0%)")).toEqual([255, 0, 0]);
    expect(rgb255("hwb(0 50% 50%)")).toEqual([128, 128, 128]);
  });

  it("converts the perceptual spaces to sRGB", () => {
    // Anchors: pure white and black exist in every space.
    expectClose("oklch(1 0 0)", [255, 255, 255]);
    expectClose("oklab(0 0 0)", [0, 0, 0]);
    expectClose("lab(100 0 0)", [255, 255, 255]);
    // sRGB red, as the CSS Color 4 spec quotes it in each space.
    expectClose("lab(54.29% 80.8 69.89)", [255, 0, 0]);
    expectClose("oklch(62.8% 0.2577 29.23)", [255, 0, 0]);
    expectClose("lch(54.29% 106.84 40.85)", [255, 0, 0]);
  });

  it("handles angle units on the hue", () => {
    expectClose("hsl(0.5turn 100% 50%)", rgb255("hsl(180 100% 50%)"));
    expectClose("hsl(200grad 100% 50%)", rgb255("hsl(180 100% 50%)"));
  });

  it("reads color() and clips out-of-gamut values", () => {
    expect(rgb255("color(srgb 1 0 0)")).toEqual([255, 0, 0]);
    // Display-P3 red is outside sRGB — it clips to the nearest in-gamut red.
    expect(rgb255("color(display-p3 1 0 0)")).toEqual([255, 0, 0]);
    expectClose("color(display-p3 0 0 0)", [0, 0, 0]);
  });

  it("returns null for things that are not colors", () => {
    expect(parseCssColor("none")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("url(x.png)")).toBeNull();
    expect(parseCssColor("color(rec2020 1 0 0)")).toBeNull();
  });
});

describe("parseColor accepts CSS colors everywhere", () => {
  it("keeps the documented hex and object forms working", () => {
    expect(parseColor("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseColor({ r: 255, g: 0, b: 0 })).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("now also takes named and functional colors", () => {
    expect(parseColor("red")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColor("rgb(0 0 255)")).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("still rejects nonsense with INVALID_COLOR", () => {
    expect(() => parseColor("not-a-color")).toThrow(FastPDFError);
    try {
      parseColor("not-a-color");
    } catch (error) {
      expect((error as FastPDFError).code).toBe("INVALID_COLOR");
    }
  });
});
