# Human review

Run `npm run eval:review -- --serve` to prepare existing runs and open the printed
local gallery URL. Opening the gallery makes no model calls or uploads. To prepare just one run, add
`--run 2026-11-03T09-07-28-868Z`. Without `--serve`, only files are generated.
Future completed eval runs also create review files automatically.

The gallery shows the actual request and frozen rendered output. Edits include
the starting artwork. Automated scores, generator explanations and model names
are hidden. The light gray backdrop is a viewing aid; SVG transparency is retained
in the original file. Rendering passes through the application's SVG validator.

Use the scoring sidebar in the browser: enter your name, choose a quality score,
mark acceptability, select problem tags and add notes. Click **Save review** or
**Save & next**. The rubric sits below the artwork, leaving the right sidebar
for the complete scoring form. Use the compact arrow buttons or case picker to navigate. Edits show
before and after side by side when space allows.

Saved ratings are loaded when you return or reload. The UI writes to that run's
`human-reviews.yaml`; manual file editing remains possible but is not required.
Saving is local and does not upload to Braintrust. Unsaved navigation prompts you
before discarding changes. If another tab or editor changes the YAML, saving
shows a conflict instead of overwriting those changes. Copy any unsaved notes
before reloading to resolve the conflict.

The server binds only to `127.0.0.1` and accepts writes only from its own review
page. No production app routes are added. The generated `review.html` can still
be viewed directly, but interactive scoring requires `--serve`.

## Rubric: human-visual-quality-v1

Rate each completed output independently. Do not rate streaming previews. Failed
runs stay generation failures, with no visual-quality rating. For an edit, judge
the resulting artwork; use the before image to assess preservation and changes.

| Score | Anchor     | Visible evidence                                                                                              |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | Broken     | Major structural or rendering defects make the subject/action difficult to understand.                        |
| 2     | Rough      | Recognizable, but conspicuous geometry, anatomy, perspective or overlap defects require substantial revision. |
| 3     | Acceptable | Coherent and readable; minor awkward details remain, with no major structural defect.                         |
| 4     | Polished   | Consistent geometry and style, clear silhouettes, deliberate composition and clean details.                   |
| 5     | Excellent  | Especially strong composition and execution; important details remain clear at normal viewing size.           |

Judge execution within the intended style. Simple flat artwork can earn 5;
complexity and realism do not earn extra points by themselves. Consider connected
structure/anatomy, perspective, overlaps, composition, consistent style and
legibility only where relevant. Use the same anchors across cases. Do not lower
quality merely because a valid style differs from your personal preference.

`acceptable` is a separate product judgment: would you deliver this artwork for
the actual request without a corrective edit? Consider both visual quality and
request fulfillment. A polished drawing can be unacceptable because it omits a
requested feature. Keep the automated prompt-fidelity score separate.

Use problem tags to group defects, and write brief observable evidence. For
example: "Helmet appears detached from torso; wheel orientations disagree."
Avoid notes consisting only of "bad" or "I don't like it."

```yaml
quality: 2
acceptable: false
problems: [perspective, anatomy]
notes: |
  Helmet appears detached from torso.
  Wheels and chassis use conflicting perspectives.
skipped: false
```

Leave `quality` and `acceptable` as `null` for unreviewed examples. Mark
`skipped: true` and explain why when you cannot make a judgment. Use `true` and
`false`, not quoted strings. Fill in your name or initials once at the top.

Each entry includes `output_sha256`, derived from the exact saved SVG source.
Do not edit that field or overwrite old results with new generations. Check the
gallery's output identity if files have been moved or changed. Review preparation
never overwrites an existing YAML file. Create a new run for changed outputs.
Run folders, including annotations, are ignored by Git: back them up or deliberately
curate reviewed examples into a separate versioned dataset when ready.

## Sync reviews to Braintrust

Click **Save review** or **Save & next**, then **Sync to Braintrust** in the page
header. This uploads all saved reviews in the selected run and shows a verified
success message or an error you can retry. The button is disabled while there
are unsaved changes, during a save, or while syncing. It does not automatically
save form drafts. Missing ratings remain unscored. If another tab changed the
saved reviews, reload before syncing. Credentials stay in the local server.

The CLI remains available. To validate saved reviews locally:

```bash
npm run eval:reviews:sync -- --run 2026-11-03T09-07-28-868Z
```

Add `--upload` to update that run's existing Braintrust experiment. This sends
your ratings, reviewer, notes and problem tags using `BRAINTRUST_API_KEY` from
`.env.local` (shell values take precedence). It makes no generation or judge calls.
Sync is explicit: editing YAML alone does not send anything.

| Braintrust score column | Mapping                                        |
| ----------------------- | ---------------------------------------------- |
| `human_visual_quality`  | Your 1–5 score divided by 5: 1 = 20%, 5 = 100% |
| `human_acceptable`      | true = 100%, false = 0%                        |

Missing/null ratings and skipped reviews are sent as `null`, not 0. They are
unscored (blank/N/A, depending on the Braintrust view) and do not count as zero
in score averages. A column may require selecting it in Braintrust's table view.
The original 1–5 value, notes, reviewer, tags and rubric version are stored in
feedback audit metadata. These are separate from the automated metrics.
New eval runs initialize the two human score columns to null. Missing human
ratings do not cause the eval CLI's strict automated-score check to fail.

Sync validates all YAML entries and their exact SVG hashes before writing.
It opens the saved experiment read-only, verifies its ID, then matches each
root row's full case input and exact saved output. Missing or ambiguous matches
stop the sync; it never creates replacement generation rows. This supports older
uploaded runs too. Local-only runs cannot be synced to a nonexistent experiment.

Rerun sync after changing ratings. Setting a rating back to null clears that
column's previous rating; omitting an entry clears both human scores for that
output. Skipped entries must have null ratings. All other scores are retained.
An upload failure can leave some updates applied; rerunning sends the same current
ratings safely. Successful sync verifies the scores by reading them back and saves
`human-review-sync.json` as a receipt. The original `results.json` remains the
generation-time export; your YAML is the local source of human ratings.

## Later judge calibration

Human ratings do not automatically train or calibrate a judge. Preserve the SVGs,
requests, reviews and rubric version together. Reserve held-out prompt families
before tuning the judge.

The gallery renders at 768 pixels with the shared transparent-padding renderer.
It is not identical to the automated judge's 512-pixel opaque-gray rendering.
Review exact transparency and SVG safety with their dedicated checks, rather
than inferring them from this visual rubric.
