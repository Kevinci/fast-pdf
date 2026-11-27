import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { PDFDocument } from "../src/index";
import { facturX } from "../src/zugferd/index";

/**
 * A ZUGFeRD / Factur-X invoice: a PDF/A-3b a person can read, with the same
 * invoice embedded as XML a machine can book.
 *
 * Two things are different from an ordinary fast-pdf document:
 *
 * 1. **You need a TrueType font.** PDF/A requires every font to be embedded,
 *    and the built-in Helvetica/Times/Courier are not. fast-pdf ships no font,
 *    so this example borrows one from the system; in your project, bundle a
 *    font you have a licence for (Inter, Noto Sans, …) and pass its bytes.
 * 2. **You bring the XML.** fast-pdf builds the container, not the invoice
 *    data. The XML below is a hand-written illustration — generate yours with
 *    an EN 16931 library and validate it before sending it to anyone.
 *
 * Run: npx tsx examples/zugferd.ts        (FAST_PDF_FONT=/path/to/font.ttf to choose the font)
 */

const FONT_CANDIDATES: [regular: string, bold: string][] = [
  // Debian/Ubuntu: apt install fonts-dejavu-core
  [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  // macOS
  [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ],
  // Windows
  ["C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\arialbd.ttf"],
];

function findFont(): [regular: string, bold: string] {
  const chosen = process.env["FAST_PDF_FONT"];
  if (chosen !== undefined) return [chosen, process.env["FAST_PDF_FONT_BOLD"] ?? chosen];
  const found = FONT_CANDIDATES.find(([regular, bold]) => existsSync(regular) && existsSync(bold));
  if (found === undefined) {
    throw new Error(
      "No TrueType font found. Set FAST_PDF_FONT=/path/to/font.ttf " +
        "(and optionally FAST_PDF_FONT_BOLD) and run again.",
    );
  }
  return found;
}

const invoice = {
  number: "R-2026-0042",
  date: "20261127",
  due: "20261211",
  seller: {
    name: "Example Software GmbH",
    street: "Musterstraße 12",
    zip: "50667",
    city: "Köln",
    vat: "DE123456789",
  },
  buyer: { name: "Beispiel AG", street: "Hauptstraße 1", zip: "10115", city: "Berlin" },
  lines: [
    { id: "1", name: "Beratung", quantity: 8, unit: "HUR", price: 120 },
    { id: "2", name: "Softwarelizenz (1 Jahr)", quantity: 1, unit: "C62", price: 490 },
  ],
  taxRate: 19,
};
const net = invoice.lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
const tax = Math.round(net * invoice.taxRate) / 100;
const gross = net + tax;
const amount = (value: number): string => value.toFixed(2);

// ── The structured invoice (UN/CEFACT CII, profile EN 16931) ──
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
 <rsm:ExchangedDocumentContext>
  <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
 </rsm:ExchangedDocumentContext>
 <rsm:ExchangedDocument>
  <ram:ID>${invoice.number}</ram:ID>
  <ram:TypeCode>380</ram:TypeCode>
  <ram:IssueDateTime><udt:DateTimeString format="102">${invoice.date}</udt:DateTimeString></ram:IssueDateTime>
 </rsm:ExchangedDocument>
 <rsm:SupplyChainTradeTransaction>
${invoice.lines
  .map(
    (line) => `  <ram:IncludedSupplyChainTradeLineItem>
   <ram:AssociatedDocumentLineDocument><ram:LineID>${line.id}</ram:LineID></ram:AssociatedDocumentLineDocument>
   <ram:SpecifiedTradeProduct><ram:Name>${line.name}</ram:Name></ram:SpecifiedTradeProduct>
   <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(line.price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
   <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${line.unit}">${line.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
   <ram:SpecifiedLineTradeSettlement>
    <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${invoice.taxRate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
    <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(line.quantity * line.price)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
   </ram:SpecifiedLineTradeSettlement>
  </ram:IncludedSupplyChainTradeLineItem>`,
  )
  .join("\n")}
  <ram:ApplicableHeaderTradeAgreement>
   <ram:SellerTradeParty>
    <ram:Name>${invoice.seller.name}</ram:Name>
    <ram:PostalTradeAddress><ram:PostcodeCode>${invoice.seller.zip}</ram:PostcodeCode><ram:LineOne>${invoice.seller.street}</ram:LineOne><ram:CityName>${invoice.seller.city}</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
    <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${invoice.seller.vat}</ram:ID></ram:SpecifiedTaxRegistration>
   </ram:SellerTradeParty>
   <ram:BuyerTradeParty>
    <ram:Name>${invoice.buyer.name}</ram:Name>
    <ram:PostalTradeAddress><ram:PostcodeCode>${invoice.buyer.zip}</ram:PostcodeCode><ram:LineOne>${invoice.buyer.street}</ram:LineOne><ram:CityName>${invoice.buyer.city}</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
   </ram:BuyerTradeParty>
  </ram:ApplicableHeaderTradeAgreement>
  <ram:ApplicableHeaderTradeDelivery>
   <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${invoice.date}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
  </ram:ApplicableHeaderTradeDelivery>
  <ram:ApplicableHeaderTradeSettlement>
   <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
   <ram:ApplicableTradeTax><ram:CalculatedAmount>${amount(tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${amount(net)}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${invoice.taxRate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
   <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${invoice.due}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
   <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    <ram:LineTotalAmount>${amount(net)}</ram:LineTotalAmount>
    <ram:TaxBasisTotalAmount>${amount(net)}</ram:TaxBasisTotalAmount>
    <ram:TaxTotalAmount currencyID="EUR">${amount(tax)}</ram:TaxTotalAmount>
    <ram:GrandTotalAmount>${amount(gross)}</ram:GrandTotalAmount>
    <ram:DuePayableAmount>${amount(gross)}</ram:DuePayableAmount>
   </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  </ram:ApplicableHeaderTradeSettlement>
 </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

// ── The readable invoice ──
const [regular, bold] = findFont();
const pdf = new PDFDocument({
  font: "invoice",
  language: "de-DE",
  margins: { top: 60, right: 50, bottom: 60, left: 50 },
  metadata: {
    title: `Rechnung ${invoice.number}`,
    author: invoice.seller.name,
    subject: "Rechnung",
    creator: "fast-pdf examples/zugferd.ts",
  },
});
pdf.registerFont(readFileSync(regular), { family: "invoice" });
pdf.registerFont(readFileSync(bold), { family: "invoice", bold: true });

// From here on the document is PDF/A-3b and carries the XML.
facturX(pdf, xml, { profile: "EN 16931" });

const euro = (value: number): string =>
  `${value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const page = pdf.pageSize;

pdf.rect(0, 0, page.width, 8, { fill: "#0f172a" });
pdf.text(invoice.seller.name, { y: 40, size: 20, bold: true, color: "#0f172a" });
pdf.text(`${invoice.seller.street} · ${invoice.seller.zip} ${invoice.seller.city}`, {
  y: 66,
  size: 9,
  color: "#64748b",
});
pdf.text("RECHNUNG", { y: 40, align: "right", size: 14, bold: true, color: "#64748b" });

pdf.y = 110;
pdf.text(
  `${invoice.buyer.name}\n${invoice.buyer.street}\n${invoice.buyer.zip} ${invoice.buyer.city}`,
  { lineHeight: 1.4 },
);
pdf.text(`Rechnungsnr.: ${invoice.number}\nDatum: 27.11.2026\nFällig bis: 11.12.2026`, {
  y: 110,
  x: page.width - 250,
  width: 200,
  align: "right",
  lineHeight: 1.4,
});

pdf.y = 220;
pdf.table(
  [
    ["Pos.", "Leistung", "Menge", "Einzelpreis", "Gesamt"],
    ...invoice.lines.map((line) => [
      line.id,
      line.name,
      String(line.quantity),
      euro(line.price),
      euro(line.quantity * line.price),
    ]),
  ],
  {
    widths: [40, 225, 60, 85, 85],
    aligns: ["left", "left", "right", "right", "right"],
    headerFill: "#0f172a",
    headerColor: "#ffffff",
    zebraFill: "#f8fafc",
  },
);
pdf.moveDown(1);
pdf.text(`Netto: ${euro(net)}`, { align: "right" });
pdf.text(`USt. ${invoice.taxRate} %: ${euro(tax)}`, { align: "right" });
pdf.text(`Gesamtbetrag: ${euro(gross)}`, { align: "right", bold: true, size: 13 });
pdf.moveDown(2);
pdf.text(
  "Diese Rechnung ist eine E-Rechnung im Format ZUGFeRD/Factur-X (Profil EN 16931). " +
    "Maßgeblich sind die eingebetteten strukturierten Daten (factur-x.xml).",
  { size: 9, color: "#64748b" },
);

mkdirSync("examples/output", { recursive: true });
await pdf.save("examples/output/zugferd.pdf");
console.log("→ examples/output/zugferd.pdf (PDF/A-3b, Factur-X EN 16931)");
