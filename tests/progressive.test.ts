import assert from "node:assert/strict";
import { test } from "node:test";
import { createSvgPreview, readStreamedSvg } from "../lib/svg/progressive-svg";
import { validateSvg } from "../lib/svg/validate-svg";

const root = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">';
const circle = '<circle cx="30" cy="30" r="20" fill="blue"/>';
const full = root + '<g>' + circle + '<text x="10" y="80">A &amp; B</text></g></svg>';

test("snapshots close parsed containers and omit unfinished elements", () => {
  const preview = createSvgPreview(root + '<g>' + circle + '<rect width="');
  assert.equal(preview?.source, root + '<g>' + circle + '</g></svg>');
  assert.equal(createSvgPreview(root + '<circle cx="'), null);
  assert.equal(createSvgPreview(full)?.source, full);
});

test("every streamed prefix is either withheld or standalone safe XML", () => {
  let snapshots = 0;
  for (let index = 0; index <= full.length; index++) {
    const preview = createSvgPreview(full.slice(0, index));
    if (preview) {
      snapshots++;
      assert.deepEqual(validateSvg(preview.source), preview);
    }
  }
  assert.ok(snapshots > 20);
});

test("unsafe, malformed and oversized draft snapshots are withheld", () => {
  for (const draft of [
    root + '<script/>',
    root + '<g onload="alert(1)">' + circle,
    root + '<image href="https://example.test/x"/>',
    '<!DOCTYPE svg>' + root + circle,
    root + circle + '</bad>',
    root + '<g>'.repeat(33) + circle,
    root + '<g/>'.repeat(1001),
    full + ' '.repeat(48_000),
  ]) assert.equal(createSvgPreview(draft), null);
});

test("partial JSON decoding preserves escapes and withholds split escape sequences", () => {
  const json = JSON.stringify({ message: "A \\\"quoted\\\" explanation", svg: full });
  assert.equal(readStreamedSvg(json), full);
  for (let index = 0; index <= json.length; index++) {
    const source = readStreamedSvg(json.slice(0, index));
    if (source !== null) assert.ok(full.startsWith(source));
  }
  assert.equal(readStreamedSvg('{"svg":"<svg\\u003'), '<svg');
  assert.equal(readStreamedSvg('{"svg":"<svg\\u003e'), '<svg>');
  assert.equal(readStreamedSvg('{"svg":"<svg\\'), '<svg');
});
