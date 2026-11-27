/**
 * The sRGB output profile every PDF/A document needs.
 *
 * PDF/A allows DeviceRGB only when the file carries an output intent with an
 * RGB destination profile (ISO 19005-3 [6.2.4.3-2]), and fast-pdf paints
 * everything in DeviceRGB — so without this, every page is a violation.
 *
 * This is `sRGB-v2-micro.icc` from the Compact ICC Profiles collection
 * (https://github.com/saucecontrol/Compact-ICC-Profiles): 456 bytes, ICC
 * v2.1, device class `mntr`, colour space `RGB`, released into the public
 * domain under CC0 1.0. It satisfies [6.2.3-1] (class `mntr` or `prtr`;
 * colour space GRAY, RGB or CMYK).
 *
 * It lives in the source as text rather than as a file next to the code on
 * purpose: a profile read from disk at runtime breaks under bundlers and on
 * edge runtimes, which is the one way a PDF/A feature can fail before it has
 * written a byte.
 */
const SRGB_BASE64 =
  "AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABgYlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//";

/** What the output intent calls this profile. */
export const SRGB_IDENTIFIER = "sRGB IEC61966-2.1";

/** The bundled sRGB profile, decoded. */
export function srgbProfile(): Uint8Array {
  const binary = atob(SRGB_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
