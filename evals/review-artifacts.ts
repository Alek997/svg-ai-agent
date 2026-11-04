import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { renderSvg } from "../lib/svg/render-svg";
import { evalCaseSchema } from "./types";

export const reviewRubricVersion = "human-visual-quality-v1";

export const savedRunSchema = z.object({
  results: z.array(
    z.object({
      input: evalCaseSchema,
      output: z
        .object({
          status: z.enum(["completed", "failed"]),
          source: z.string().nullable(),
        })
        .nullish(),
    }),
  ),
});

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export async function prepareReview(directory: string) {
  const run = savedRunSchema.parse(
    JSON.parse(await readFile(resolve(directory, "results.json"), "utf8")),
  );
  const cards: string[] = [];
  const reviews: string[] = [];
  let failed = 0;
  for (const row of run.results) {
    if (row.output?.status !== "completed" || !row.output.source) {
      failed++;
      continue;
    }
    const item = row.input;
    const hash = createHash("sha256").update(row.output.source).digest("hex");
    // Render through the application's validator. Raw SVG never enters the HTML.
    const result = await renderSvg(row.output.source, 768);
    const before = item.input.currentSvg
      ? await renderSvg(item.input.currentSvg, 768)
      : null;
    const picture = (png: Buffer, caption: string) =>
      `<figure><figcaption>${caption}</figcaption><img alt="${caption}" src="data:image/png;base64,${png.toString("base64")}"></figure>`;
    cards.push(`<article id="${escapeHtml(item.id)}" data-hash="${hash}"><h2>${cards.length + 1}. ${escapeHtml(item.id)}</h2>
      ${item.input.messages.map((message) => `<p class="prompt"><b>${escapeHtml(message.role)}:</b> ${escapeHtml(message.content)}</p>`).join("")}
      <div class="images">${before ? picture(before, "Before edit") : ""}${picture(result, "Result to review")}</div>
      <details><summary>Prompt fidelity checklist (separate from visual quality)</summary><ul>${item.expected.requirements.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul></details>
      <details><summary>Exact output identity</summary><code>${hash}</code></details></article>`);
    reviews.push(`  - case: ${JSON.stringify(item.id)}
    output_sha256: ${JSON.stringify(hash)}
    quality: null # Integer 1–5; null means not scored
    acceptable: null # true / false; independent of quality
    problems: [] # perspective, anatomy, structure, overlaps, composition, style, legibility, other
    notes: "" # Specific visible evidence; or use a YAML | multiline block
    skipped: false
`);
  }
  const yaml = `# Review the frozen outputs in review.html. Never change output_sha256.
# Blank/null scores are unreviewed, not zero. Failed runs have no visual rating.
rubric_version: ${JSON.stringify(reviewRubricVersion)}
reviewer: "" # Your name or initials
reviews:
${reviews.length ? reviews.join("\n") : "  []\n"}`;
  const reviewPath = resolve(directory, "human-reviews.yaml");
  try {
    await writeFile(reviewPath, yaml, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Human annotations are never overwritten by rerunning preparation.
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="review-token" content="__REVIEW_TOKEN__"><title>SVG human review</title><style>
    *{box-sizing:border-box}body{font:14px/1.45 system-ui,sans-serif;color:#17202a;background:#f6f7f9;margin:0;padding:16px}
    h1{font-size:21px;margin:0}h2{font-size:17px;margin:0 0 12px}p{margin:8px 0}a{color:#174ea6}code{overflow-wrap:anywhere}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px}
    .layout{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px;max-width:1440px;margin:auto}
    .toolbar,article,aside,.rubric-panel{background:white;border:1px solid #dce0e5;border-radius:10px;padding:16px}
    .toolbar{display:flex;gap:6px;align-items:center;margin-bottom:12px;padding:8px 10px}.toolbar select{flex:1;min-width:0;width:0;font-size:12px;padding:5px}.toolbar button{flex:none;width:28px;height:28px;padding:0;font-size:16px;line-height:1}.toolbar .hint{white-space:nowrap;font-size:11px}.rubric-panel{margin-top:12px}
    aside{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 110px);overflow:hidden;display:flex;flex-direction:column}aside>h2,aside>.rubric,aside>.hint,aside>.status{flex-shrink:0}aside form{overflow:auto;min-height:0;border-top:1px solid #e5e7eb;padding-top:4px}
    .prompt{white-space:pre-wrap;font-size:13px;max-height:120px;overflow:auto}.images{display:flex;gap:12px;flex-wrap:wrap}
    figure{flex:1;min-width:180px;margin:10px 0}figcaption{font-weight:600;margin-bottom:4px}
    img{display:block;width:100%;height:260px;object-fit:contain;background:#e5e7eb;border:1px solid #dce0e5;border-radius:6px}
    details{margin:12px 0}summary{cursor:pointer}.rubric{font-size:12px;padding-left:20px;margin:8px 0}.rubric li{margin-bottom:5px}
    label{display:block;font-weight:600;margin-top:8px}input,select,textarea,button{font:inherit}input[type=text],select,textarea{width:100%;padding:6px;border:1px solid #b8c0cc;border-radius:5px;background:white}
    textarea{resize:vertical}button{padding:8px 12px;border:1px solid #b8c0cc;border-radius:6px;background:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}
    .primary{background:#174ea6;color:white;border-color:#174ea6}.actions{display:flex;gap:8px;margin-top:8px;position:sticky;bottom:0;background:white;padding:6px 0}.hint{font-size:12px;color:#526071}.status{min-height:22px;margin-top:8px;font-size:13px}.error{color:#b42318}.tags{display:flex;gap:4px 10px;flex-wrap:wrap}.tags label{font-weight:400;font-size:12px;margin:0}
    [hidden]{display:none!important}@media(max-width:780px){body{padding:10px}.layout{grid-template-columns:minmax(0,1fr) 300px;gap:10px}aside{padding:12px;top:10px}img{height:190px}.toolbar{padding:10px}article{padding:12px}}
    @media(max-width:600px){header{display:block}.layout{display:flex;flex-direction:column}aside{position:static;max-height:none;width:100%}.images img{height:200px}}
    </style><header><div><h1>Review SVG outputs</h1><p class="hint">${cards.length} outputs · ${failed} failed/missing · Save reviews, then sync this run.</p></div><div style="text-align:right;max-width:350px"><div style="display:flex;gap:12px;align-items:center;justify-content:flex-end"><a href="/">All runs</a><button id="sync-braintrust" type="button" disabled>Sync to Braintrust</button></div><p id="sync-status" role="status" aria-live="polite" class="hint">Uploads saved scores and review notes for this run.</p></div></header>
    <div class="layout"><main><div class="toolbar"><button id="previous" type="button" aria-label="Previous SVG" title="Previous SVG">←</button><select id="case-picker" aria-label="Choose SVG">${run.results
      .filter((row) => row.output?.status === "completed" && row.output.source)
      .map(
        (row) =>
          `<option value="${escapeHtml(row.input.id)}">${escapeHtml(row.input.id)}</option>`,
      )
      .join(
        "",
      )}</select><button id="next" type="button" aria-label="Next SVG" title="Next SVG">→</button><span id="progress" class="hint"></span></div>
    ${cards.join("\n")}<section class="rubric-panel" aria-label="Visual quality rubric"><h2>Visual quality rubric</h2><ol class="rubric">
    <li><b>Broken:</b> Major defects make the subject or action hard to understand.</li>
    <li><b>Rough:</b> Recognizable; conspicuous structural or visual defects need substantial revision.</li>
    <li><b>Acceptable:</b> Coherent and readable, with minor awkward details.</li>
    <li><b>Polished:</b> Consistent geometry and style, clear silhouettes, deliberate composition.</li>
    <li><b>Excellent:</b> Strong composition and execution; important details remain clear at normal size.</li></ol>
    <p class="hint">Judge execution within the intended style. Simple artwork can earn 5. Gray is a viewing backdrop.</p>
    </section></main><aside aria-label="Scoring"><h2>Your review</h2>
    <form id="review-form"><fieldset id="review-fields" disabled style="border:0;padding:0;margin:0"><label for="reviewer">Reviewer</label><input id="reviewer" type="text" maxlength="200" placeholder="Your name or initials">
    <label for="quality">Quality</label><select id="quality"><option value="">N/A · unscored</option><option value="1">1 · Broken</option><option value="2">2 · Rough</option><option value="3">3 · Acceptable</option><option value="4">4 · Polished</option><option value="5">5 · Excellent</option></select>
    <label for="acceptable">Would you deliver this result?</label><select id="acceptable"><option value="">N/A · unscored</option><option value="true">Yes</option><option value="false">No</option></select><p class="hint">Consider appearance and the actual request; for edits, also preservation.</p>
    <label>Problems</label><div class="tags">${["perspective", "anatomy", "structure", "overlaps", "composition", "style", "legibility", "other"].map((tag) => `<label><input type="checkbox" name="problem" value="${tag}"> ${tag}</label>`).join("")}</div>
    <label for="notes">Notes</label><textarea id="notes" rows="2" maxlength="5000" placeholder="What specifically works or needs fixing?"></textarea>
    <label><input id="skipped" type="checkbox"> Skip / uncertain</label>
    <div class="actions"><button class="primary" type="submit" id="save">Save review</button><button type="button" id="save-next">Save & next</button></div></fieldset>
    </form><p role="status" aria-live="polite" id="save-status" class="status">Loading saved ratings…</p>
    <noscript>Start npm run eval:review -- --serve and enable JavaScript to score in the UI.</noscript></aside></div><script src="/review.js" defer></script></html>`;
  await writeFile(resolve(directory, "review.html"), html);
  return { html, count: cards.length, failed, reviewPath };
}
