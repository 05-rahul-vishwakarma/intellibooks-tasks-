// Text extraction per page for PDF, DOCX, and TXT files

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export async function parseTxt(buffer: Buffer): Promise<ParsedPage[]> {
  const text = buffer.toString("utf-8");
  return [{ pageNumber: 1, text }];
}

export async function parsePdf(buffer: Buffer): Promise<ParsedPage[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();
  const pages: ParsedPage[] = (data.pages || []).map((p: any) => ({
    pageNumber: p.num || 1,
    text: p.text || "",
  }));
  return pages;
}

export async function parseDocx(buffer: Buffer): Promise<ParsedPage[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return [{ pageNumber: 1, text: result.value }];
}

export async function parseFile(
  buffer: Buffer,
  mimetype: string
): Promise<ParsedPage[]> {
  if (mimetype === "application/pdf") return parsePdf(buffer);
  if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return parseDocx(buffer);
  }
  if (mimetype.startsWith("text/") || mimetype === "application/octet-stream") {
    return parseTxt(buffer);
  }
  throw new Error(`Unsupported file type: ${mimetype}`);
}