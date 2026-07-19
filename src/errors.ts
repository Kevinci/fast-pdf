/**
 * FastPDFError — the error type thrown for all user-facing failures.
 *
 * `code` is a stable, machine-readable identifier; messages may be
 * reworded between versions, codes are part of the public API.
 */
export type FastPDFErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_COLOR"
  | "UNKNOWN_FONT"
  | "UNKNOWN_PAGE_FORMAT"
  | "UNSUPPORTED_IMAGE"
  | "INVALID_FONT_FILE"
  | "INVALID_IMAGE_FILE"
  | "IMAGE_TOO_LARGE"
  | "UNSAFE_LINK"
  | "INTERNAL";

export class FastPDFError extends Error {
  constructor(
    message: string,
    readonly code: FastPDFErrorCode = "INVALID_ARGUMENT",
  ) {
    super(message);
    this.name = "FastPDFError";
  }
}