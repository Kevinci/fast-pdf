/**
 * fast-pdf — fast, dependency-free, direct-to-PDF generation.
 *
 * The public API: everything needed to build a document and to check up
 * front whether the platform supports it. Anything not exported here is
 * internal and may change between minor versions.
 *
 * Two further entry points sit beside this one:
 *
 * - `fast-pdf/dom` — `tableToPDF()` and friends, browser-only.
 * - `fast-pdf/internal` — the engine below `PDFDocument`. Not SemVer-stable.
 */

export { PDFDocument } from "./document/document";
export type {
  PDFDocumentOptions,
  PageOptions,
  PageBreakOptions,
  AppendOptions,
  TextOptions,
  ImageOptions,
  SvgOptions,
  MarkdownOptions,
  LineOptions,
  RectOptions,
  ShapeOptions,
  OpacityOption,
  SizeInput,
  ContainerOptions,
  ColumnsOptions,
  GridOptions,
  FlowItem,
  FlowColumnsOptions,
  FlowColumnsResult,
  ClipRect,
  RegionOptions,
  RegionResult,
  TextMeasurement,
  BlockMeasurement,
  FontMetricsInfo,
  PageInfo,
  PageDecorator,
  HeaderFooterOptions,
  PageNumberOptions,
  WatermarkOptions,
  SignatureOptions,
  ButtonOptions,
  OutlineOptions,
  TOCOptions,
  ObjectTableColumn,
  ObjectTableOptions,
} from "./document/document";

export { FastPDFError, type FastPDFErrorCode } from "./errors";

export type {
  CellValue,
  TableCell,
  TableOptions,
  CellBox,
  CellBorders,
  CellBorderSide,
  VerticalAlign,
} from "./layout/table";

export { parseCssColor, type ParsedCssColor } from "./types/css-color";

export {
  PAGE_FORMATS,
  parseColor,
  type ColorInput,
  type RGB,
  type FontFamily,
  type TextAlign,
  type Margins,
  type PageSize,
  type PageFormatName,
  type DocumentMetadata,
} from "./types/index";

export type { Font } from "./fonts/font";

// Reading an existing PDF before appending it.
export { pdfInfo, type PDFInfo } from "./pdf/reader";

// Feature detection — both of these answer "will this run here?".
export { supportsCompression } from "./pdf/compress";
export {
  supportsEncryption,
  type EncryptionOptions,
  type DocumentPermissions,
} from "./pdf/encrypt";

export type { SigningOptions } from "./pdf/sign";
