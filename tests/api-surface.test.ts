import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The frozen surface, types included.
 *
 * `entry-points.test.ts` pins every runtime export, but most of what 1.0.0
 * promises is types — the option bags, the result shapes — and those vanish
 * at runtime. This file asks the TypeScript compiler for the complete export
 * list of each SemVer-covered entry point and compares it with the lists
 * below.
 *
 * From 1.0.0 on the rule is: names may be ADDED in a minor release (extend the
 * list in the same commit), and a name is REMOVED or RENAMED only in a major
 * release. If this test fails and you did not intend to change the public
 * API, the change is wrong, not the list.
 *
 * `fast-pdf/pdfa` and `fast-pdf/zugferd` joined in 1.1 and are pinned the same
 * way. `fast-pdf/internal` is deliberately absent: it is not covered by SemVer.
 */

const CORE = [
  "AppendOptions",
  "BlockMeasurement",
  "ButtonOptions",
  "CellBorderSide",
  "CellBorders",
  "CellBox",
  "CellValue",
  "CheckboxOptions",
  "ClipRect",
  "ColorInput",
  "ColumnsOptions",
  "ContainerOptions",
  "DocumentMetadata",
  "DocumentPermissions",
  "DropdownOptions",
  "EncryptionOptions",
  "FastPDFError",
  "FastPDFErrorCode",
  "FlowColumnsOptions",
  "FlowColumnsResult",
  "FlowItem",
  "Font",
  "FontFamily",
  "FontMetricsInfo",
  "GridOptions",
  "HeaderFooterOptions",
  "ImageOptions",
  "LineOptions",
  "Margins",
  "MarkdownOptions",
  "ObjectTableColumn",
  "ObjectTableOptions",
  "OpacityOption",
  "OutlineOptions",
  "PAGE_FORMATS",
  "PDFDocument",
  "PDFDocumentOptions",
  "PDFInfo",
  "PageBreakOptions",
  "PageDecorator",
  "PageFormatName",
  "PageInfo",
  "PageNumberOptions",
  "PageOptions",
  "PageSize",
  "ParsedCssColor",
  "RGB",
  "RadioGroupOptions",
  "RectOptions",
  "RegionOptions",
  "RegionResult",
  "ShapeOptions",
  "SignatureOptions",
  "SigningOptions",
  "SizeInput",
  "SvgOptions",
  "TOCOptions",
  "TableCell",
  "TableOptions",
  "TextAlign",
  "TextFieldOptions",
  "TextMeasurement",
  "TextOptions",
  "VerticalAlign",
  "WatermarkOptions",
  "parseColor",
  "parseCssColor",
  "pdfInfo",
  "supportsCompression",
  "supportsEncryption",
];

const DOM = [
  "StyleReader",
  "TablePDFOptions",
  "TablePdfButtonHandle",
  "TablePdfButtonOptions",
  "TableSource",
  "attachTablePdfButton",
  "downloadTablePDF",
  "tableToPDF",
  "tableToRows",
];

const PDFA = [
  "PdfAAttachment",
  "PdfAConformance",
  "PdfAHandle",
  "PdfAOptions",
  "PdfAOutputProfile",
  "PdfARelationship",
  "pdfA",
];

const ZUGFERD = [
  "FacturXOptions",
  "FacturXProfile",
  "PdfAConformance",
  "PdfAHandle",
  "PdfAOutputProfile",
  "PdfARelationship",
  "facturX",
];

/** The public methods of `PDFDocument` — the API most callers ever touch. */
const DOCUMENT_METHODS = [
  "addPage",
  "anchor",
  "append",
  "button",
  "checkbox",
  "circle",
  "clip",
  "columns",
  "container",
  "dropdown",
  "ellipse",
  "ensureSpace",
  "flowColumns",
  "fontMetrics",
  "footer",
  "grid",
  "header",
  "image",
  "keepTogether",
  "line",
  "link",
  "markdown",
  "measureBlock",
  "measureText",
  "moveDown",
  "onPage",
  "outline",
  "pageBackground",
  "pageBreak",
  "pageNumbers",
  "radioGroup",
  "rect",
  "region",
  "registerFont",
  "render",
  "save",
  "signature",
  "svg",
  "table",
  "text",
  "textField",
  "toBlob",
  "toBuffer",
  "toStream",
  "toc",
  "watermark",
  "widthOfText",
];

const entry = (relative: string): string =>
  fileURLToPath(new URL(`../src/${relative}`, import.meta.url));

const files = {
  core: entry("index.ts"),
  dom: entry("dom/index.ts"),
  pdfa: entry("pdfa/index.ts"),
  zugferd: entry("zugferd/index.ts"),
};

const program = ts.createProgram(Object.values(files), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();

function moduleSymbol(file: string): ts.Symbol {
  const source = program.getSourceFile(file);
  const symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`no module symbol for ${file}`);
  return symbol;
}

function exportNames(file: string): string[] {
  return checker
    .getExportsOfModule(moduleSymbol(file))
    .map((symbol) => symbol.getName())
    .sort();
}

function publicMembers(file: string, className: string): string[] {
  const exported = checker
    .getExportsOfModule(moduleSymbol(file))
    .find((symbol) => symbol.getName() === className);
  if (!exported) throw new Error(`${className} is not exported from ${file}`);
  const target =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const instance = checker.getDeclaredTypeOfSymbol(target);
  return instance
    .getProperties()
    .filter((member) => {
      const flags = ts.getCombinedModifierFlags(member.valueDeclaration as ts.Declaration);
      return !(flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
    })
    .map((member) => member.getName())
    .filter((name) => !name.startsWith("#"))
    .sort();
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe("frozen API surface (values and types)", () => {
  it("fast-pdf exports exactly the frozen list", () => {
    expect(exportNames(files.core)).toEqual([...CORE].sort(byCodePoint));
  });

  it("fast-pdf/dom exports exactly the frozen list", () => {
    expect(exportNames(files.dom)).toEqual([...DOM].sort(byCodePoint));
  });

  it("fast-pdf/pdfa exports exactly the frozen list", () => {
    expect(exportNames(files.pdfa)).toEqual([...PDFA].sort(byCodePoint));
  });

  it("fast-pdf/zugferd exports exactly the frozen list", () => {
    expect(exportNames(files.zugferd)).toEqual([...ZUGFERD].sort(byCodePoint));
  });

  it("PDFDocument keeps every public method it shipped with", () => {
    // Additions are fine and expected; a missing name is a breaking change.
    const members = publicMembers(files.core, "PDFDocument");
    for (const method of DOCUMENT_METHODS) {
      expect(members, `PDFDocument.${method} disappeared`).toContain(method);
    }
  });
});
