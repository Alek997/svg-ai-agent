# SVG evals: a walkthrough

An eval is a repeatable experiment: run the same requests through the application,
measure the results, and compare them after changing a model or prompt. This is
an evaluation dataset, not training data. It does not change model weights.

## Start here

```bash
# Validate cases and print the selected scorers. No API calls or uploads.
npm run eval

# Check one case before spending credits.
npm run eval -- --case weather --judge --braintrust

# Generate one SVG and apply the basic scorers, saving results locally.
npm run eval -- --live --case weather

# Add visual fidelity scoring and record the experiment in Braintrust.
npm run eval -- --live --case weather --judge --braintrust --name baseline

# Run the full small dataset with the same settings.
npm run eval -- --live --judge --braintrust --name baseline
```

Only `--live` starts model calls. `--judge` adds one judge call per safe completed
case, with no judge retries. `--braintrust` uploads the cases, outputs, scores,
and traces. Without it, Braintrust's SDK runs locally with `noSendLogs: true`.
The CLI loads `.env.local`; existing shell environment variables take precedence.
It does not load Next.js's full hierarchy of environment files.

In Braintrust, create an account, choose or create your project, and
create an API key in your account settings. Set these values in `.env.local`:

```dotenv
OPENAI_API_KEY=your-local-key
OPENAI_MODEL=gpt-6-luna
BRAINTRUST_API_KEY=your-local-braintrust-key
BRAINTRUST_PROJECT=<your project name>
EVAL_JUDGE_MODEL=gpt-6-luna
```

Never put real keys in the dataset or commit `.env.local`. These are CLI/server
variables, not browser variables. The judge model is independently configurable
and must accept image inputs and structured output. Generation and judging default
to `gpt-6-luna`; set `EVAL_JUDGE_MODEL` to override the judge. Calibrate results
against human-reviewed examples. See the
[model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

## 1. Dataset — what do we ask, and what should happen?

Edit `cases.json`. Each row has:

- `id`: a unique, stable identifier, also used for the saved SVG filename.
- `tags`: labels for filtering; for example `--tag edit` or `--tag easy`.
- `input`: the same messages and optional `currentSvg` sent to the production
  generation flow. An edit has a fixed starting SVG so it is reproducible.
- `expected.requirements`: a checklist of visible requirements. There is no
  single ideal SVG: many drawings can satisfy the same checklist.

Copy a row, give it a new id, and edit the request and requirements. No runner
changes are needed. Alternatively pass `--dataset path/to/cases.json` to use
another dataset with the same structure. `types.ts` uses Zod to reject invalid
requests, duplicate ids, empty checklists, and unsafe starting artwork before
any model call. Inferred TypeScript types keep the rest of the code consistent.

Write atomic requirements: "exactly three raindrops" is easier to judge than
"a perfect weather illustration". Keep the checklist fixed during comparisons;
do not generate a different checklist for each output.

## 2. Task — what application behavior do we run?

`task.ts` calls the existing **streaming** `generateSvg()` function, rather than
building a second agent or copying its system prompt. It captures public step
and tool events, provider-reported usage, total generation time, and time to
first valid preview snapshot. That preview time is a server measurement, not
the time the browser actually paints an image.

The final metadata and SVG are independently validated before accepting success.
A failure returns a failed result row, rather than disappearing from the suite.
Raw provider exception messages are not saved. Token usage unavailable after
a thrown generation is `null`; it does not mean the failed request was free.
Repeated preview payloads are omitted to avoid storing many copies of the SVG.

This evaluates the drawing engine directly: it does not run Clerk authentication,
conversation persistence, HTTP input-policy checks or private collection retrieval.
Those paths have separate application tests. The generation model comes from
`OPENAI_MODEL`. Production step, token, retry and deadline limits still apply.
`config.ts` additionally caps a suite at 20 cases;
the runner uses one trial and concurrency one. These limit work, not exact
dollar spend. There is no automatic full-request retry.

## 3. Scorers — how do we judge the result?

`scorers.ts` exports ordinary functions plus the editable `basicScorers` list.
Each scorer receives the case and task output, and returns a name, a score from
0 to 1 (or `null` if unavailable), and optional evidence in `metadata`.

| Scorer | Meaning |
| --- | --- |
| `completion` | 1 when the task finishes with accepted final output; otherwise 0 |
| `safe_svg` | 1 when the final source passes the application's XML/SVG validator |
| `tool_protocol` | 1 when a completed run respects the step bound, finishes with validated artwork, and reads artwork before proposing an edit |
| `prompt_fidelity` (optional) | Fraction of checklist requirements visibly satisfied, assessed by the vision judge |

Completion and safety will often move together because the task already rejects
unsafe output. Neither checks appearance. Tool protocol checks observable behavior,
not whether a repair or edit was visually correct. Keep these dimensions separate;
a high fidelity score cannot compensate for a failed safety gate.

To add a deterministic scorer, define a `Scorer` object in `scorers.ts` and append
it to `basicScorers`. For example, a size-budget scorer could inspect source
length. Label that a markup budget, not visual simplicity or drawing quality.
Add focused mocked tests for important new scoring behavior.

### The visual scorer

`vision-scorer.ts` validates SVG before rendering it with Sharp. It produces a
512×512 PNG using the shared `lib/svg/render-svg.ts` renderer. It preserves SVG
transparency with transparent padding, then sends the image and requirements to an
image-capable model and requests structured verdicts. Edits include two images:
result first, starting artwork second. The assistant's explanation and SVG source
are not given to the judge as evidence.

Edit `judge-prompt.ts` to adjust the judge instructions. Edit `config.ts` for
image size, timeout, and output token limits. Change `rubricVersion` when you
change the scoring rules. Each checklist verdict contains its index and brief
visible evidence. Code verifies that every index appears exactly once and
calculates the score; the judge does not invent the final percentage.

If three of four checks pass, the score is 0.75. If any check is uncertain, the
case returns `null` and `needsReview: true`. Invalid/incomplete judge output or a
render/judge failure also returns `null`. A generation failure scores 0 because
there is no accepted artwork to evaluate. Review null counts alongside averages:
missing scores are not passes and may be omitted from Braintrust averages.

Vision judgment can be wrong, especially for counting, perspective, subtle edits,
and transparency. How the image service displays transparent pixels can affect
white or pale artwork visibility; a vision verdict cannot establish an exact
transparency contract. Use an XML/alpha check for that property. Judge agreement must
be checked against a small human-labeled sample, including intentionally wrong
drawings. Do not use uncalibrated scores as deployment gates.

## 4. Runner and Braintrust — where do the measurements go?

`run.ts` connects the parts using Braintrust's `Eval()` API. It adapts ordinary
scorers to Braintrust's scorer arguments, uses the local JSON dataset, and records
each run as a private experiment when `--braintrust` is selected. The dataset
remains editable and versioned in Git; this step does not create a separately
managed Braintrust dataset.

Braintrust's AI SDK 7 telemetry is registered only inside this eval CLI. It can
capture model/tool spans within experiment tasks and judge calls. The task output
also retains the application's public step/tool events. Browser generations are
not instrumented by this setup. Check the first live experiment before relying
on span completeness; automated verification uses a mock provider.

Every finished run saves `results.json` and accepted SVGs under
`evaluations/runs/<timestamp>/`, ignored by Git. JSON contains per-case scores,
judge evidence/usage, generation usage/timing, and the Braintrust experiment URL
when available. A nonzero exit code flags failures, unavailable scores, or any
score below 1. This is a strict review signal, not a production quality threshold.
Braintrust connection failures stop the run. Uploaded experiments are inspected
in Braintrust; the application UI has no experiment dashboard.

## Comparing experiments

Keep cases, scorer rules, judge model, and rendering settings fixed. Change only
the generation prompt or model, and run another named experiment. Inspect per-case
regressions as well as averages, and compare token usage and latency separately
from quality. One trial is a smoke evaluation; use repeated runs before claiming
a small difference is a reliable improvement.

The runner records the configuration and hashes of the dataset, agent file,
scorer files, and judge prompt. These make changed inputs/settings visible; Git
history remains the source for retrieving the corresponding code. The shared
renderer is not separately hashed or versioned by the runner. Record the code
revision and rendering settings with each experiment; runs produced with different
backdrops or renderers are not identical evaluation settings. Version future
rendering/scoring changes explicitly. Maintain a
small held-out set of cases you do not use while tuning prompts to reduce overfitting.

This setup intentionally records tokens rather than dollar estimates; prices,
cached-token discounts, and unavailable failed-call usage need deliberate handling.

## Tests

`npm test` covers dataset rejection, failure accounting, SVG safety, tool ordering,
PNG rendering, checklist integrity, judge uncertainty, mocked vision requests,
and Braintrust local evaluation. Automated tests use mock providers and make no
live model calls or cloud uploads. See the [main README](../README.md#evaluation-and-tests)
for repository check commands and the separate database/browser test setup.

References: [Braintrust code evals](https://www.braintrust.dev/docs/evaluate/run-in-code),
[Braintrust TypeScript SDK](https://www.braintrust.dev/docs/reference/libs/nodejs),
[OpenAI eval best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
