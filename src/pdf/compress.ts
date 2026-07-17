/**
 * Flate (zlib/RFC 1950) compression via the Web Compression Streams API.
 *
 * CompressionStream is backed by native zlib in every modern runtime
 * (Node >= 18, Bun, Deno, browsers, workerd) — as fast as any native addon,
 * with zero bundle bytes. Where unavailable, callers fall back to
 * uncompressed streams (valid PDF, just larger).
 */

export function supportsCompression(): boolean {
  return typeof CompressionStream !== "undefined";
}

export function supportsDecompression(): boolean {
  return typeof DecompressionStream !== "undefined";
}

async function pipeThrough(
  data: Uint8Array,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Deflate (zlib format, as expected by /FlateDecode). Returns null if unsupported. */
export async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (!supportsCompression()) return null;
  return pipeThrough(data, new CompressionStream("deflate"));
}

/** Inflate a zlib stream. Throws if the runtime lacks DecompressionStream. */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (!supportsDecompression()) {
    throw new Error("DecompressionStream is not available in this runtime");
  }
  return pipeThrough(data, new DecompressionStream("deflate"));
}
