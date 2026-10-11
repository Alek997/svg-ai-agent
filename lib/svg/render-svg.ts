import "server-only";
import sharp from "sharp";
import { safeSvgSchema } from "./validate-svg";
// Used by ingestion and evaluations; no raster asset is persisted.
export async function renderSvg(source: string, size = 256): Promise<Buffer> {
  if (!Number.isInteger(size) || size < 1 || size > 1024)
    throw new Error("Invalid raster size.");
  const safe = safeSvgSchema.parse(source);
  return sharp(Buffer.from(safe.source), { limitInputPixels: 4096 * 4096 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
