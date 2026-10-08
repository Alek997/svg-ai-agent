import { SaxesParser } from "saxes";
import { z } from "zod";
import { MAX_SVG_LENGTH } from "../workspace/contracts";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const elements = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
]);
const attributes = new Set([
  "id",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "dx",
  "dy",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "fr",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "preserveAspectRatio",
]);
const referenceAttributes = new Set(["fill", "stroke", "clip-path", "mask"]);
const fragmentPaint = /^url\(#[A-Za-z_][\w.-]*\)$/;

export class InvalidSvgError extends Error {
  constructor(message = "The SVG failed safety validation. Try a simpler description.") {
    super(message);
  }
}

// Reject the entire document rather than silently removing parts of the artwork.
// SAX provides XML structure and decoded attribute values; regex only checks values.
export function validateSvg(source: string) {
  if (!source.trim() || source.length > MAX_SVG_LENGTH)
    throw new InvalidSvgError();
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let count = 0;
  let dimensions: { width: number; height: number } | undefined;
  const fail = (message = "SVG is malformed or contains unsupported content.") => {
    throw new InvalidSvgError(message);
  };
  parser.on("error", () => fail("Malformed XML: check matching tags and quoted attributes."));
  parser.on("doctype", () => fail("DOCTYPE is forbidden."));
  parser.on("processinginstruction", () => fail("Processing instructions are forbidden."));
  parser.on("xmldecl", () => fail("Remove the XML declaration; start with <svg>."));
  parser.on("opentag", (tag) => {
    if (++depth > 32 || ++count > 1000) fail("Use at most 1000 elements and nesting depth 32.");
    if (tag.uri !== SVG_NAMESPACE || tag.prefix || !elements.has(tag.local))
      fail(`Unsupported element or namespace: ${tag.name}.`);
    if (depth === 1) {
      if (tag.local !== "svg" || dimensions) fail("Use exactly one svg root element.");
      const viewBox = tag.attributes.viewBox?.value
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite))
        fail("The root needs a viewBox with four finite numbers.");
      const [, , width, height] = viewBox!;
      if (width <= 0 || height <= 0 || width > 4096 || height > 4096) fail("viewBox width and height must be positive and at most 4096.");
      dimensions = { width, height };
    } else if (tag.local === "svg") fail("Nested svg elements are unsupported; use g instead.");
    for (const attribute of Object.values(tag.attributes)) {
      if (
        attribute.name === "xmlns" &&
        depth === 1 &&
        attribute.value === SVG_NAMESPACE
      )
        continue;
      if (attribute.prefix || attribute.uri || !attributes.has(attribute.name))
        fail(`Unsupported attribute: ${attribute.name}. Use presentation attributes, no styles, href or event handlers.`);
      const value = attribute.value.trim();
      // No style, href, event handlers, embedded resources, or indirect CSS references.
      if (/url\s*\(/i.test(value)) {
        if (
          !referenceAttributes.has(attribute.name) ||
          !fragmentPaint.test(value)
        )
          fail("References must be local url(#id) in fill, stroke, clip-path or mask.");
      }
      if (
        /\\|[\u0000-\u001f]|(?:https?:|data:|javascript:|file:|\/\/)/i.test(
          value,
        )
      )
        fail("External resources, control characters and CSS escapes are forbidden.");
    }
  });
  parser.on("closetag", () => {
    depth--;
  });
  try {
    parser.write(source).close();
  } catch (error) {
    throw error instanceof InvalidSvgError ? error : new InvalidSvgError();
  }
  if (!dimensions) throw new InvalidSvgError();
  return { source: source.trim(), ...dimensions };
}

export const safeSvgSchema = z
  .string()
  .min(1)
  .max(MAX_SVG_LENGTH)
  .transform((source, context) => {
    try {
      return validateSvg(source);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof InvalidSvgError ? error.message : "SVG is malformed or contains unsupported content.",
      });
      return z.NEVER;
    }
  });
