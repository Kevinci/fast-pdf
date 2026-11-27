import type { DocumentMetadata } from "../types/index";

/**
 * XMP packet writer — the metadata stream PDF/A requires at the catalog.
 *
 * Kept deliberately small: fixed namespaces, simple values, no parser. The
 * one job is to produce a packet that is well-formed XML and RDF, UTF-8
 * encoded, and carries the PDF/A identification (ISO 19005-3 [6.6.2.1],
 * [6.6.4]).
 */

/** One custom property declared through a PDF/A extension schema. */
export interface XmpProperty {
  name: string;
  value: string;
  description: string;
}

/**
 * A namespace outside the predefined XMP schemas. PDF/A permits such
 * properties only when the same packet declares them in a PDF/A extension
 * schema ([6.6.2.3.1], [6.6.2.3.2]) — so declaration and values are generated
 * from one list and cannot drift apart.
 */
export interface XmpExtensionSchema {
  schema: string;
  namespaceURI: string;
  prefix: string;
  properties: XmpProperty[];
}

export interface XmpInput {
  part: number;
  conformance: string;
  metadata: DocumentMetadata;
  producer: string;
  date?: Date;
  extensions: XmpExtensionSchema[];
}

/** Escape character data and attribute values; drop what XML 1.0 forbids. */
export function escapeXml(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    // XML 1.0 has no way to write most C0 controls, not even as a character
    // reference, and a lone surrogate or U+FFFE/U+FFFF is not a character.
    else if (
      cp === 0x9 ||
      cp === 0xa ||
      cp === 0xd ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      cp >= 0x10000
    )
      out += ch;
  }
  return out;
}

/** XMP dates are ISO 8601; always UTC here, matching the Info dictionary. */
function xmpDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const description = (namespaces: string, body: string): string =>
  `  <rdf:Description rdf:about=""${namespaces}>\n${body}  </rdf:Description>\n`;

const simple = (tag: string, value: string): string => `   <${tag}>${escapeXml(value)}</${tag}>\n`;

const langAlt = (tag: string, value: string): string =>
  `   <${tag}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${tag}>\n`;

function extensionDeclaration(schemas: XmpExtensionSchema[]): string {
  let items = "";
  for (const schema of schemas) {
    let properties = "";
    for (const property of schema.properties) {
      properties +=
        `       <rdf:li rdf:parseType="Resource">\n` +
        `        <pdfaProperty:name>${escapeXml(property.name)}</pdfaProperty:name>\n` +
        `        <pdfaProperty:valueType>Text</pdfaProperty:valueType>\n` +
        `        <pdfaProperty:category>external</pdfaProperty:category>\n` +
        `        <pdfaProperty:description>${escapeXml(property.description)}</pdfaProperty:description>\n` +
        `       </rdf:li>\n`;
    }
    items +=
      `     <rdf:li rdf:parseType="Resource">\n` +
      `      <pdfaSchema:schema>${escapeXml(schema.schema)}</pdfaSchema:schema>\n` +
      `      <pdfaSchema:namespaceURI>${escapeXml(schema.namespaceURI)}</pdfaSchema:namespaceURI>\n` +
      `      <pdfaSchema:prefix>${escapeXml(schema.prefix)}</pdfaSchema:prefix>\n` +
      `      <pdfaSchema:property>\n      <rdf:Seq>\n${properties}      </rdf:Seq>\n      </pdfaSchema:property>\n` +
      `     </rdf:li>\n`;
  }
  return description(
    ' xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"' +
      ' xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"' +
      ' xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"',
    `   <pdfaExtension:schemas>\n    <rdf:Bag>\n${items}    </rdf:Bag>\n   </pdfaExtension:schemas>\n`,
  );
}

/** The byte-order mark the XMP specification puts in the packet header. */
const BOM = String.fromCodePoint(0xfeff);

/** Build the XMP packet as a string. Encode it as UTF-8 before writing. */
export function buildXmp(input: XmpInput): string {
  const m = input.metadata;
  let body = "";

  body += description(
    ' xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"',
    simple("pdfaid:part", String(input.part)) + simple("pdfaid:conformance", input.conformance),
  );

  let dc = simple("dc:format", "application/pdf");
  if (m.title !== undefined) dc += langAlt("dc:title", m.title);
  if (m.author !== undefined)
    dc += `   <dc:creator><rdf:Seq><rdf:li>${escapeXml(m.author)}</rdf:li></rdf:Seq></dc:creator>\n`;
  if (m.subject !== undefined) dc += langAlt("dc:description", m.subject);
  body += description(' xmlns:dc="http://purl.org/dc/elements/1.1/"', dc);

  let pdf = simple("pdf:Producer", input.producer);
  if (m.keywords !== undefined) pdf += simple("pdf:Keywords", m.keywords);
  body += description(' xmlns:pdf="http://ns.adobe.com/pdf/1.3/"', pdf);

  let xmp = "";
  if (m.creator !== undefined) xmp += simple("xmp:CreatorTool", m.creator);
  if (input.date !== undefined) {
    const stamp = xmpDate(input.date);
    xmp += simple("xmp:CreateDate", stamp) + simple("xmp:ModifyDate", stamp);
  }
  if (xmp !== "") body += description(' xmlns:xmp="http://ns.adobe.com/xap/1.0/"', xmp);

  for (const schema of input.extensions) {
    let values = "";
    for (const property of schema.properties) {
      values += simple(`${schema.prefix}:${property.name}`, property.value);
    }
    body += description(` xmlns:${schema.prefix}="${escapeXml(schema.namespaceURI)}"`, values);
  }
  if (input.extensions.length > 0) body += extensionDeclaration(input.extensions);

  // The packet header carries neither `bytes` nor `encoding` ([6.6.2.1-2/-3]).
  // The begin attribute is the BOM, as the XMP specification prescribes.
  return (
    `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    body +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}
