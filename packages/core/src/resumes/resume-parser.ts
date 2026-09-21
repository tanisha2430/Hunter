/**
 * Deterministic text extraction from an uploaded resume file. Scanned/
 * image-only PDFs are rejected — no OCR in Phase 1.
 */

export class UnextractableResumeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnextractableResumeError";
  }
}

const MIN_EXTRACTED_CHARS = 100;

export async function extractResumeText(file: Buffer, mimeType: string): Promise<string> {
  let text: string;

  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(file);
    text = result.text;
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: file });
    text = result.value;
  } else {
    throw new UnextractableResumeError(
      `Unsupported file type "${mimeType}" — upload a text-based PDF or DOCX.`,
    );
  }

  const trimmed = text.trim();
  if (trimmed.length < MIN_EXTRACTED_CHARS) {
    throw new UnextractableResumeError(
      "Could not extract readable text — this looks like a scanned/image-only PDF. Upload a text-based PDF or DOCX instead.",
    );
  }

  return trimmed;
}
