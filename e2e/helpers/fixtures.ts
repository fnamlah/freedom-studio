import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { STATE_DIR } from "./state";

/**
 * Tiny valid files for upload tests, generated at runtime so no binary
 * fixtures live in the repo.
 */

/** Minimal single-page PDF with a line of text. */
export function makePdf(text: string): string {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + "\n";
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  mkdirSync(STATE_DIR, { recursive: true });
  const path = join(STATE_DIR, `fixture-${Date.now()}.pdf`);
  writeFileSync(path, Buffer.from(pdf, "latin1"));
  return path;
}

/** 1x1 red PNG. */
export function makePng(): string {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  mkdirSync(STATE_DIR, { recursive: true });
  const path = join(STATE_DIR, `fixture-${Date.now()}.png`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}
