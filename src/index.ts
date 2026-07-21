/**
 * fast-pdf — fast, dependency-free, direct-to-PDF generation.
 *
 * Public API surface. Everything not exported here is internal and may
 * change between minor versions.
 */

export { PDFDocument } from "./document/document";
export type {
  PDFDocumentOptions,
  PageOptions,
  PageBreakOptions,
  TextOptions,
  ImageOptions,
  LineOptions,
  RectOptions,
  ShapeOptions,
  SizeInput,
  ContainerOptions,
  ColumnsOptions,
  GridOptions,
  PageInfo,
  PageDecorator,
  HeaderFooterOptions,
  PageNumberOptions,
  WatermarkOptions,
  SignatureOptions,
  OutlineOptions,
  TOCOptions,
  ObjectTableColumn,
  ObjectTableOptions,
} from "./document/document";

export { FastPDFError, type FastPDFErrorCode } from "./errors";

export type { CellValue, TableCell, TableOptions } from "./layout/table";

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
export { EmbeddedFont } from "./fonts/embedded";
export { TTFFont } from "./fonts/ttf";

// Low-level engine — exported for advanced use and future extensions.
export { PDFWriter } from "./pdf/writer";
export { ContentStream } from "./pdf/content";
export { Ref, Name, PDFString, serialize, type PDFValue } from "./pdf/objects";
export { deflate, inflate, supportsCompression } from "./pdf/compress";
export {
  createSecurityHandler,
  supportsEncryption,
  type EncryptionOptions,
  type DocumentPermissions,
} from "./pdf/encrypt";
