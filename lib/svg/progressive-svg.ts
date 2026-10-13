import { SaxesParser } from "saxes";
import { validateSvg } from "./validate-svg";
import { MAX_SVG_LENGTH } from "../workspace/contracts";

// Only checkpoint after XML parser events for completed elements. Never close
// an unfinished tag/attribute or render the raw streamed markup.
export function createSvgPreview(source: string) {
  if (source.length > MAX_SVG_LENGTH) return null;
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  let checkpoint = "";
  let failed = false;
  let elements = 0;
  const fail = () => {
    failed = true;
    throw new Error("Invalid draft");
  };
  parser.on("error", fail);
  parser.on("doctype", fail);
  parser.on("xmldecl", fail);
  parser.on("processinginstruction", fail);
  parser.on("opentag", (tag) => {
    if (++elements > 1000 || stack.length >= 32) fail();
    stack.push(tag.name);
  });
  parser.on("closetag", () => {
    stack.pop();
    checkpoint =
      source.slice(0, parser.position) +
      [...stack]
        .reverse()
        .map((name) => `</${name}>`)
        .join("");
  });
  try {
    // Do not call close(): end-of-document errors are expected during streaming.
    parser.write(source);
    if (failed || !checkpoint) return null;
    return validateSvg(checkpoint);
  } catch {
    return null;
  }
}

// Read a partial JSON string field without repairing XML. Complete JSON strings
// use JSON.parse; unfinished escapes are withheld until the next chunk arrives.
export function readStreamedSvg(json: string, field = "svg"): string | null {
  let index = 0;
  while (index < json.length) {
    if (json[index++] !== '"') continue;
    const start = index;
    while (index < json.length) {
      if (json[index] === "\\") {
        index += 2;
        continue;
      }
      if (json[index] === '"') break;
      index++;
    }
    if (index >= json.length) return null;
    let value: string;
    try {
      value = JSON.parse('"' + json.slice(start, index) + '"');
    } catch {
      return null;
    }
    index++;
    if (value !== field) continue;
    while (/\s/.test(json[index] ?? "") && index < json.length) index++;
    if (json[index++] !== ":") continue;
    while (/\s/.test(json[index] ?? "") && index < json.length) index++;
    if (json[index++] !== '"') return null;
    const valueStart = index;
    let end = index;
    while (index < json.length) {
      if (json[index] === '"') break;
      if (json[index] === "\\") {
        const size = json[index + 1] === "u" ? 6 : 2;
        if (index + size > json.length) break;
        index += size;
      } else index++;
      end = index;
    }
    try {
      return JSON.parse('"' + json.slice(valueStart, end) + '"');
    } catch {
      return null;
    }
  }
  return null;
}
