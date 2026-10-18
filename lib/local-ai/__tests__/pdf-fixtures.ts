import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";

/** Synthetic, public test text only. Never opens a user document or account. */
export async function fixturePdf(pages: { native?: string; image?: string; imagePng?: Buffer; blankImage?: boolean }[]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = document.addPage([600, 300]);
    if (spec.image || spec.imagePng || spec.blankImage) {
      const text = spec.image?.replace(/[<>&"']/g, "") ?? "";
      const png = spec.imagePng ?? await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="white"/><text x="70" y="180" font-family="sans-serif" font-size="56" fill="black">${text}</text></svg>`)).png().toBuffer();
      const image = await document.embedPng(png);
      const scale = Math.min(600 / image.width, 300 / image.height);
      page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
    }
    if (spec.native) page.drawText(spec.native, { x: 30, y: 260, size: 14, font });
  }
  return Buffer.from(await document.save());
}
