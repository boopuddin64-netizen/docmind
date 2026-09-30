/**
 * Turns Word / Excel / CSV / TXT uploads into plain text for the scan model (images and PDFs are sent to Gemini inline
 * instead). Pure server-side helpers with no Express / Gemini dependency, so they are unit-testable.
 */
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";
import { DOC_MIME, DOCX_MIME, XLSX_MIME, XLS_MIME } from "../src/lib/uploadFormats.js";

/** Text handed to the model is capped so one huge spreadsheet can not blow the prompt / cost. */
export const MAX_EXTRACTED_CHARS = 60_000;
/** Zip-bomb guard: refuse OOXML packages that would inflate beyond this many bytes. */
export const MAX_UNCOMPRESSED_BYTES = 40_000_000;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 2_000;

/** User-facing failure (corrupt / encrypted / empty document). The route maps it to a friendly 422. */
export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

/** Reads the ZIP central directory (no inflating): entry names + total declared uncompressed size. */
export function inspectZip(buf: Buffer): { names: string[]; totalUncompressed: number } {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new DocumentExtractionError("This file is not a valid Office document (it may be corrupt).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) throw new DocumentExtractionError("This document is too complex to read.");
  const names: string[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new DocumentExtractionError("This file is not a valid Office document (it may be corrupt).");
    }
    total += buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (total > MAX_UNCOMPRESSED_BYTES) throw new DocumentExtractionError("This document is too large to read.");
  return { names, totalUncompressed: total };
}

function cap(text: string): string {
  const t = text.replace(/\r\n?/g, "\n").replace(/[^\S\n]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_EXTRACTED_CHARS ? t.slice(0, MAX_EXTRACTED_CHARS) : t;
}

async function docxText(buf: Buffer): Promise<string> {
  const { names } = inspectZip(buf);
  if (!names.includes("word/document.xml")) throw new DocumentExtractionError("This file does not look like a Word (.docx) document.");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

async function docText(buf: Buffer): Promise<string> {
  const doc = await new WordExtractor().extract(buf);
  return [doc.getBody(), doc.getFootnotes?.(), doc.getHeaders?.({ includeBody: false })].filter(Boolean).join("\n\n");
}

function sheetsText(buf: Buffer, mime: string): string {
  if (mime === XLSX_MIME) {
    const { names } = inspectZip(buf);
    if (!names.includes("xl/workbook.xml")) throw new DocumentExtractionError("This file does not look like an Excel (.xlsx) workbook.");
  }
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, sheetRows: MAX_ROWS_PER_SHEET + 1, WTF: false });
  const out: string[] = [];
  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, dateNF: "dd/mm/yyyy" }).trim();
    if (csv.replace(/[,\s]/g, "")) out.push(`## Sheet: ${name}\n${csv}`);
  }
  return out.join("\n\n");
}

/**
 * Extracts readable text from a base64 Office/text upload. Throws DocumentExtractionError with a user-safe message when
 * the file is corrupt, password-protected, unsupported or has no text.
 */
export async function extractDocumentText(base64: string, mime: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  let text: string;
  try {
    switch (mime) {
      case DOCX_MIME: text = await docxText(buf); break;
      case DOC_MIME: text = await docText(buf); break;
      case XLSX_MIME:
      case XLS_MIME: text = sheetsText(buf, mime); break;
      case "text/plain":
      case "text/csv": text = buf.toString("utf8").replace(/^\uFEFF/, ""); break;
      default: throw new DocumentExtractionError("That file type can not be read as text.");
    }
  } catch (e) {
    if (e instanceof DocumentExtractionError) throw e;
    console.error("document text extraction failed:", mime, e);
    throw new DocumentExtractionError("We could not open that document. It may be corrupt or password-protected. Try re-saving it or exporting it as PDF.");
  }
  const final = cap(text);
  if (!final) throw new DocumentExtractionError("We could not find any text in that document. If it only contains pictures, upload a photo or PDF of it instead.");
  return final;
}
