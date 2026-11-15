# SVG Studio: project overview

SVG Studio is a web application for creating and editing SVG artwork through
conversation. A user describes an icon, logo or illustration, sees safe
progressive previews, and refines the result with follow-up messages. Completed
artwork is saved with its conversation and can be inspected, copied, downloaded
and shared. Because the result is SVG code, it can also be embedded in web pages
and other applications. Private reference collections extend generation with examples from
an owner's existing SVG library.

The project also includes an evaluation framework for testing generation,
editing, policy decisions and tool behavior. It combines deterministic checks,
optional model-based visual judging and blind human review. This makes changes
to models, prompts and tools reviewable against saved examples.

This document describes the repository as inspected on **15 November 2026**.
Implementation dates come from Git history. Production configuration, deployed
behavior and live provider performance were not checked for this document.
Technical rationales describe documented constraints and how the implementation
addresses them; they do not claim to reconstruct personal reasons for choosing
vendors or alternatives that were never recorded.

## Reading guide

- [Product and implemented functionality](#product-and-implemented-functionality)
- [Stack and technical rationale](#stack-and-technical-rationale)
- [Architecture and generation workflow](#architecture-and-generation-workflow)
- [Persistence and concurrent requests](#persistence-and-concurrent-requests)
- [SVG safety and rendering](#svg-safety-and-rendering)
- [Private collections and retrieval](#private-collections-and-retrieval)
- [Tracking, feedback and privacy](#tracking-feedback-and-privacy)
- [Evaluation framework](#evaluation-framework)
- [Development and deployment workflow](#development-and-deployment-workflow)
- [Implementation timeline](#implementation-timeline)
- [Plans and current limitations](#plans-and-current-limitations)
- [Code map and supporting documentation](#code-map-and-supporting-documentation)

## Product and implemented functionality

The main interface is an authenticated workspace containing chat and an SVG
canvas. The conversation supplies intent and editing instructions; the canvas
shows the current artwork. Users do not need to write SVG markup. Source
inspection is available, but direct source or canvas editing is not implemented.

| Area                       | Implemented behavior                                                                                                      | Purpose                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Creation and editing       | Natural-language requests, follow-up edits, bounded validation and repair.                                                | Keep creation and refinement in one conversation.                    |
| Preview                    | Validated progressive snapshots, zoom/reset and a source view.                                                            | Show progress before the complete result is ready.                   |
| Export                     | Copy source and download completed, server-validated SVGs.                                                                | Produce reusable vector assets outside the application.              |
| Saved work                 | Persisted conversations, history, gallery, loading states and failed-request retries.                                     | Continue work after navigation or reload.                            |
| Execution details          | Visible model steps, tool activity and successful drawing token usage.                                                    | Make the generation process inspectable.                             |
| Public sharing             | Result-specific public pages and SVG endpoints for ordinary completed artwork.                                            | Share a particular saved version without sharing the conversation.   |
| Policy                     | Moderation, SVG-scope classification, clarification and conversational replies in English and Serbian.                    | Avoid unnecessary drawing and handle unsupported or unsafe requests. |
| Private collections        | Upload/index SVGs, add generated artwork, retrieve references, inspect rankings, retry processing and reindex embeddings. | Ground generation in an existing private reference library.          |
| Feedback and observability | Optional Braintrust generation logs and owner-bound feedback.                                                             | Investigate generation behavior and collect user assessments.        |
| Evaluations                | A standalone runner, deterministic scorers, visual judging, reproducible reports and blind human review.                  | Compare changes using explicit expectations.                         |

Clerk authentication protects the workspace. Collections additionally require
`feature-rag` in Clerk private metadata. Uploaded eval review requires the
independent `admin-eval` capability. These are server-enforced permissions, not
just hidden navigation items. Sign-in, sign-up and request-access pages exist;
invitation/waitlist behavior depends on the Clerk application's settings.

Ordinary results are **public by link automatically**. Copying a link does not
turn sharing on. Collection-based conversations are private, and adding generated
artwork to a collection permanently makes its conversation private.

## Stack and technical rationale

The application uses one Next.js repository for the browser interface and server
orchestration, with an independent Node.js evaluation entry point. The table
records declared package versions or major versions at this snapshot; the lockfile
records exact installed dependency resolution.

| Technology                                      | Role                                                                                                 | Technical rationale and tradeoff                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js 16.3.8, App Router                      | Pages, server rendering, API Route Handlers and review Server Actions.                               | Co-locates the product interface and authenticated server operations. Request-bound inference depends on the hosting runtime's duration limits.                    |
| React 19.2.8                                    | Interactive chat, canvas, collections and review interfaces.                                         | Supports incremental stream-driven UI updates and explicit ownership of request and preview state.                                                                 |
| TypeScript, strict mode                         | Application, server and eval code.                                                                   | Makes shared contracts and state transitions checkable across layers. Runtime validation is still required.                                                        |
| Tailwind CSS 4                                  | Responsive styling.                                                                                  | Keeps styling close to the components and supports the workspace's desktop and smaller-screen layouts.                                                             |
| Zod 4                                           | Requests, structured model output, streams, stored results and eval data.                            | Uses runtime schemas with inferred types at trust boundaries rather than trusting TypeScript alone.                                                                |
| AI SDK 7 and `@ai-sdk/openai` 4.0.85            | Streaming inference, structured output and the drawing tool loop.                                    | Supplies model/tool orchestration while the application controls safety, persistence and finalization. The policy Decisions integration is experimental.           |
| OpenAI                                          | Drawing, moderation, scope decisions, collection descriptions, embeddings and optional eval judging. | Different model roles can be configured independently. External inference requires credentials, budgets and explicit privacy boundaries.                           |
| Clerk 7                                         | Authentication and private-metadata capabilities.                                                    | Supplies server-authenticated identity; application code still scopes every private resource operation to its owner.                                               |
| Neon PostgreSQL and pgvector                    | Conversations, artwork, collection state, full-text search and vectors.                              | Keeps transactional application state and private retrieval in the same database. pgvector is required by committed migrations even when collections are disabled. |
| Drizzle ORM 0.45                                | Typed schema, queries and reviewed SQL migrations.                                                   | Keeps the data model explicit and supports transactional claims and quotas. Migrations remain a separate operational step.                                         |
| Saxes 6                                         | XML parsing for validation and progressive snapshots.                                                | Allows structural validation and parser-built previews without regex-based XML repair.                                                                             |
| Sharp 0.35                                      | Safe SVG rasterization for indexing, deterministic render checks and review/judge images.            | Shares rendering behavior across retrieval and evaluation; validation always precedes rendering.                                                                   |
| Tavily                                          | Optional web-search tool.                                                                            | Supplies bounded text references for unfamiliar subjects without embedding remote assets in artwork.                                                               |
| Braintrust 3                                    | Optional app traces, eval experiments and shared human reviews.                                      | Links outputs, scores and review evidence. Uploaded-run review uses Braintrust as its source of truth across devices.                                              |
| Node.js 22 and npm                              | Local development, server tooling, evals and tests.                                                  | Runs the TypeScript tooling and production generation engine outside the browser.                                                                                  |
| ESLint 9, Prettier 3.7.4, Husky and lint-staged | Static checks, formatting and pre-commit enforcement.                                                | Keeps conventions enforceable during ordinary development.                                                                                                         |
| Vercel deployment target                        | Hosts the Next.js application.                                                                       | The route and generation budgets are designed around a 300-second route ceiling; actual deployment support must be verified.                                       |

The Neon driver uses WebSockets through `ws`; Next.js keeps that package external
for native optional-module loading. Database pools are scoped and closed around
server operations. Database transactions do not remain open during model calls.

### Model configuration

[`lib/ai/config.ts`](../lib/ai/config.ts) resolves model IDs exclusively from
server environment variables, without code defaults. `.env.example` supplies
sample settings. Drawing (`OPENAI_MODEL`), scope (`OPENAI_SCOPE_MODEL`), moderation
(`OPENAI_MODERATION_MODEL`), collection description (`COLLECTION_DESCRIPTION_MODEL`),
collection embedding (`COLLECTION_EMBEDDING_MODEL`) and eval judging
(`EVAL_JUDGE_MODEL`) are independent. Embeddings must support 1,536 dimensions.
Missing or blank settings fail when the role is used, not at build time.

The header displays `OPENAI_MODEL_LABEL` (default: “SVG assistant”), never a raw
provider ID. Internal tracking and eval metadata retain configured IDs for
reproducibility. An eval `--model` override changes drawing for that process only.

## Architecture and generation workflow

### Responsibility boundaries

| Location           | Responsibilities                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Browser            | Chat and navigation, submission/cancellation, NDJSON stream parsing, provisional previews, source inspection and export controls.      |
| Next.js server     | Authentication, ownership, trusted context loading, policy, retrieval, provider calls, tool execution, SVG validation and persistence. |
| External services  | Clerk identity, OpenAI inference, Tavily search, Neon storage and optional Braintrust logging/review.                                  |
| Local eval process | Dataset validation, direct engine execution, rendering, scoring, report creation and optional uploads.                                 |

The browser never receives provider credentials and does not run the model.
The model proposes artwork and tool calls; the server executes tools and decides
whether a result satisfies the application's contracts.

In the workspace client, `useWorkspaceSession` coordinates submission, cancellation
and saved-state recovery. `workspace-session-state.ts` groups related UI state
changes in a reducer; request effects stay in the hook, and display flags derived
from that state are calculated when rendering. `useSavedConversation` owns saved
conversation loading and lease-expiry refreshes.

### A message from submission to saved result

1. **Submit.** The browser sends a message, request identity and expected
   conversation revision to `/api/generate`. It cannot choose an owner or supply
   authoritative model history or current artwork.
2. **Authenticate and claim.** The server obtains the Clerk user ID, checks
   ownership, and transactionally claims the conversation. Duplicate requests,
   stale revisions and concurrent runs are handled before inference begins.
3. **Restore trusted context.** Saved messages and the latest completed artwork
   supply the generation state. The server emits `started` before policy work.
4. **Apply policy.** Moderation and scope decisions run before drawing, tools or
   previews. A rejected request stops generation. Clarification or social replies
   preserve existing artwork. Unavailable or malformed policy responses fail
   closed. Server-owned reply copy supports English and Serbian Latin/Cyrillic.
5. **Retrieve private references when selected.** Owner-scoped collection search
   supplies bounded reference source, descriptions and style observations.
6. **Run the drawing agent.** The model reads current artwork when editing,
   proposes complete SVGs, and uses validation feedback to repair failures within
   the same bounded request. Optional search supplies unfamiliar subject details.
7. **Stream progress.** NDJSON events communicate activity, steps, tools, public
   response text, safe SVG snapshots and retrieval evidence. Failures after the
   stream begins arrive as stream events.
8. **Finalize.** The model's structured final response supplies a message and
   filename. The server attaches the latest accepted SVG and validates the final
   result independently.
9. **Persist before success.** The server commits the completed response and
   artwork, then emits final success. The browser can now offer the new download.

A preview is provisional. If generation fails, the previous completed artwork
remains available. There is no detached worker or reconnectable generation
stream: work depends on the request, and expired unfinished runs are recovered
on later access.

### Drawing-agent tools

All tools execute on the server with request-local state.

| Tool          | Contract                                                                        | Reason for the design                                                                                       |
| ------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `querySvg`    | Returns current validated source and its request-local revision.                | Gives editing explicit access to existing artwork without treating client-supplied source as authoritative. |
| `validateSvg` | Takes a complete proposed SVG; returns errors or accepted revision/dimensions.  | Makes structural feedback available for bounded repair and establishes which candidate can be finalized.    |
| `webSearch`   | Returns bounded Tavily snippets and URLs for a query, with optional time range. | Adds factual context for unfamiliar subjects while treating results as untrusted data.                      |

There is no SVG patch tool or screenshot-inspection tool. Edits submit a complete
replacement SVG. Policy, retrieval, preview extraction and persistence are
pipeline steps, rather than model-selected tools.

The final response omits a second copy of the SVG because validated tool state
already owns it. A failed latest proposal blocks finalization; an earlier valid
proposal cannot silently become the final result after a later invalid attempt.

### Operational bounds

| Boundary                    | Current limit                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| User prompt                 | 1–2,000 characters.                                                                                               |
| Selected generation history | At most 20 messages and 16,000 characters.                                                                        |
| Drawing loop                | At most six model steps and 32,768 output tokens per step.                                                        |
| Provider retries            | At most two SDK retries for transient failures.                                                                   |
| Generation budget           | Shared 290-second cancellation deadline; 300-second route/browser ceilings.                                       |
| Policy                      | 15-second budget, no retries and four prior context messages.                                                     |
| Search                      | At most two attempts, including failures; five bounded text results per attempt and a ten-second search deadline. |

These bounds constrain individual requests. They are not shared per-user
rate/cost quotas. The eval timeout limitation described below also means a
cancellation deadline must not be interpreted as a guarantee that every
uncooperative operation settles at that exact wall-clock time.

## Persistence and concurrent requests

The database has seven application tables:

| Table                   | Stored responsibility                                                               |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `conversations`         | Owner, revision, privacy, optional collection and active-generation lease.          |
| `messages`              | Conversation turns, statuses, retry relationships and structured execution details. |
| `svg_results`           | Completed artwork associated with assistant results.                                |
| `collections`           | Owner-scoped reference libraries.                                                   |
| `collection_icons`      | Source, processing state, descriptions, tags and embeddings.                        |
| `collection_references` | Retained evidence of references used by conversations.                              |
| `collection_usage`      | Transactionally enforced processing/search quotas.                                  |

Three separate controls make submissions safe across retries and tabs:

- **Conversation revision:** a new submission must match the revision last
  loaded by the browser, preventing edits against stale saved state.
- **Active run claim:** one generation owns the conversation at a time. Later
  writes must still belong to that run.
- **Request ID:** redelivery of an accepted request returns its recorded
  status/result rather than starting duplicate work.

For example, two tabs load revision 5. Tab A submits and advances the conversation
to revision 6. A new request from tab B using revision 5 is rejected; tab B must
reload and wait for any active generation to finish. The checks happen inside a
transaction, so simultaneous requests cannot both acquire the conversation.

Execution details checkpoint during generation. Accepted messages survive a
connection loss, and a 330-second lease allows later access to mark abandoned
work interrupted. Recovery restores usability; it does not resume inference.
The tools' request-local SVG revision is separate from the saved conversation
revision: one tracks accepted proposals within a run, the other saved state
across requests.

## SVG safety and rendering

SVG is executable document input unless constrained. Generated source, uploaded
files and retrieved references are all untrusted. Validation rejects unsafe
content rather than stripping it and silently changing the artwork.

The Saxes-based XML validator requires an allowed SVG root/namespace, valid
attributes and a finite positive viewBox. Limits include 48,000 characters,
1,000 elements, nesting depth 32 and viewBox dimensions no larger than 4,096.
Scripts, event handlers, `foreignObject`, embedded images, styles, `href`
resources, document declarations and external resources are rejected. Supported
paint, mask and clip references must be local fragments such as `url(#id)`.

Progressive preview extraction follows parsed XML element boundaries and builds
standalone snapshots. Snapshots pass validation before display. The browser
renders validated source through Blob URLs in image elements, retains the last
safe preview and revokes obsolete URLs. Raw markup is never injected into the
page. Incomplete drafts cannot be downloaded as completed artwork.

Sharp rasterization also validates first. Transparent contain-padding preserves
artwork proportions for collection thumbnails and eval images. Structural
validation establishes safety and renderability, not whether the drawing is
visually correct. Ordinary generation does not inspect its own rendered output
with a vision model before displaying it.

### Public links

`/s/<publicId>` identifies one completed result. A later edit creates another
result rather than changing the old link. Short public IDs and legacy UUID links
resolve only when their conversation is public.

The anonymous SVG endpoint returns only validated source with a generic filename
and restrictive response headers, including `no-store` and `noindex`. It does
not disclose conversation history, owner identity, usage or feedback. Text,
titles and descriptions inside the SVG itself remain part of the shared source.
There is no independent expiry or revoke control for ordinary links.

## Private collections and retrieval

Collections implement retrieval-augmented generation: existing artwork becomes
reference context for a new request. They are owner-scoped and gated by
`feature-rag` in authenticated Clerk private metadata.

### Indexing workflow

1. Upload standalone SVGs or add the latest generated artwork to a collection.
2. Validate source and deduplicate source hashes within that collection.
3. Render a temporary transparent 256×256 PNG.
4. Use a vision-capable model to generate a structured description and tags.
5. Embed searchable text built from filename, description and tags.
6. Store the source, metadata, processing state and 1,536-dimensional vector.

The temporary PNG is not stored. Description and embedding stages have separate
state and attempt counters, so an embedding failure does not discard a completed
description. Processing supports pause/resume, explicit stage retries and
embedding reindexing. Scheduling runs while the collection page remains open;
it is not a durable background job. Expired interrupted work requires explicit
retry because an earlier provider attempt may already have been billed.

### Retrieval workflow

The search query combines the initial actionable request with the latest
follow-up. Retrieval ranks collection icons with both exact pgvector cosine
similarity and PostgreSQL full-text search over filename, description and tags.
The top ten candidates from each ranking are combined using equal-weight
reciprocal rank fusion with `k=60` and stable ID tie-breaking.

Rank fusion combines positions rather than incomparable raw similarity and
keyword scores. Exact vector search is consistent with the current bounded
collection size; the repository does not establish it as a benchmarked choice
for much larger libraries.

Up to three complete SVG references fit a combined 48,000-character source
budget. Oversized references are skipped whole rather than truncated into
invalid XML. Parsed fill, stroke and viewBox conventions supply additional style
observations. The drawing prompt receives bounded reference data and treats
embedded instructions as untrusted. Details and a retrieval playground expose
ranking evidence and owner-only reference previews.

### Limits and privacy

| Bound                | Limit                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Collections per user | 5.                                                               |
| Icons per collection | 200.                                                             |
| Upload size          | 64 KiB plus the shared 48,000-character SVG limit.               |
| Processing batch     | Up to five claimed icons.                                        |
| Attempts             | Three per processing stage, with explicit retries after failure. |
| Vision analysis      | 200 attempts per user/day.                                       |
| Retrieval            | 120 searches per user/hour.                                      |

Quotas use UTC windows, count failed attempts and are enforced transactionally
across tabs/server instances. Embedding-model changes require explicit reindexing
so vectors remain compatible with search.

Collection conversations are private. Adding artwork to a collection permanently
makes the source conversation private, revoking all its public links and feedback
permissions. Deleting a collection does not restore public access. Removing
icons/collections removes retained reference source copies, but cannot recall
copies already delivered to browsers.

“Private” means owner-only access in SVG Studio. Configured OpenAI services still
process collection source/context and images. It does not mean local inference.

## Tracking, feedback and privacy

Braintrust serves three distinct purposes: optional application observability,
uploaded eval experiments and human reviews of those experiments. Enabling one
does not automatically enable the others.

Ordinary generation logging requires an API key and
`BRAINTRUST_TRACKING_ENABLED=true`. The application observer records history,
starting/final SVG, bounded tool activity, status, successful drawing token usage
and the Clerk user ID. It does not fetch profile emails or automatically redact
user-entered content. A recording notice is shown in the workspace. The observer
keeps application tracing separate from provider telemetry; logging failure is
best effort and does not fail generation.

User feedback requires a sufficiently long signing secret. HMAC-signed
permissions bind feedback to an owner and Braintrust row, expire after seven
days, and are checked against saved completed messages. Feedback upload failures
are reported so users can retry. Private runs skip generation logging and reject
feedback. Making previously ordinary work private does not erase logs already
uploaded to Braintrust.

Provider requests use configured server-side credentials and `store: false`
where specified. This does not establish external account settings or retention
policies. Braintrust access and retention are separate service configuration.
Token counts shown for generation exclude policy, search and collection work;
failed attempts may incur additional usage. The UI does not estimate dollar cost.

## Evaluation framework

### Purpose and coverage boundary

Evaluations ask separate questions: did the workflow complete correctly, was the
SVG safe, were tools used correctly, were requested pixels preserved, and did the
result satisfy the visual request? Keeping those measurements separate prevents
a good average from hiding a safety or critical-content failure.

The runner is an independent Node process that invokes the production policy
and drawing engine. It does not drive the HTTP endpoint, authenticate users or
exercise conversation persistence and real private collection retrieval end to
end. Application tests cover those boundaries separately.

### Components

| Component                                                       | Responsibility                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `evals/cases.json` and `types.ts`                               | Scenario data and Zod-validated expectations.                            |
| `evals/run.ts` and `config.ts`                                  | CLI selection, trial execution, Braintrust integration and artifacts.    |
| `evals/task.ts`                                                 | Production engine execution and bounded observations.                    |
| `evals/scorers.ts`                                              | Deterministic completion, safety, policy, tool, canary and pixel checks. |
| `evals/vision-scorer.ts` and `judge-prompt.ts`                  | Optional rendered-image checklist judging.                               |
| `evals/report.ts`                                               | Pass reporting, missing scores, variation and paired comparisons.        |
| `evals/scorer-calibration.json`                                 | Fixed visual anchors for checking judge behavior.                        |
| `evals/review*`, `human-reviews.ts` and `braintrust-reviews.ts` | Local blind review, annotation files and explicit synchronization.       |
| `app/eval-runs/` and `lib/eval-review/`                         | Capability-gated blind review of uploaded experiments.                   |

### Dataset design

The current default dataset contains **40 challenge cases**: 20 drawing/edit,
10 policy/ambiguity and 10 injection/tool cases. There are 29 development cases
and 11 holdout cases. Related scenario families remain entirely within one split,
reducing leakage from tuning against closely related holdout examples.

Cases cover connected geometry, topology, occlusion, routing, selective edits,
transparency, valid and rejected requests, clarification, social messages and
injected instructions in source/history/search/reference content. Tool cases
include reading before editing, mandatory validation, external-resource rejection
and search limits.

A case declares a stable ID, category, family, mode, tags, request and expected
outcome: generate, reject, clarify or conversation. Drawing cases specify visible
requirements and optional critical requirements. Additional expectations can
require/forbid tools, prohibit source/message strings and declare render regions.
The dataset validator checks IDs, safe starting artwork, compatible expectations,
normalized regions and family-consistent splits. Expected outcomes guide scoring;
they are not supplied as instructions to steer execution.

The November 14 dataset revision replaced the former 15-case set with these
40 cases. Older runs are historical artifacts, not directly comparable evidence
against the revised dataset. Three separate calibration anchors show a correct
blue circle, a subtly shifted circle and an incorrect red square.

### Execution and automated scoring

Drawing-mode cases call the production generation stream directly. Policy-mode
cases first call the production policy gate; rejection, clarification and social
outcomes must not start drawing, tools or previews. Injection/tool search and
retrieved-content fixtures use bounded in-memory data rather than live Tavily.
Other generation cases retain configured optional search behavior.

Each task records observed outcome/policy, final source/message, sanitized errors,
tokens, duration, first-preview latency, steps, validation attempts and bounded
tool events. Final artwork is independently checked against application contracts.

| Scorer               | Method                      | Meaning                                                                                                                            |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `completion`         | Observed outcome            | Generation or policy response matches the expected disposition.                                                                    |
| `safe_svg`           | Application XML validator   | Final source satisfies structural and safety rules.                                                                                |
| `policy_accuracy`    | Policy comparison           | The production gate made the expected decision; not applicable to drawing-only cases.                                              |
| `tool_protocol`      | Recorded events             | Step/search limits, query-before-edit, latest accepted validation, required/forbidden tools and no drawing before policy approval. |
| `output_constraints` | Final source/message checks | Declared forbidden strings are absent. Starting-source canaries are excluded to avoid penalizing preservation alone.               |
| `render_checks`      | Sharp and RGBA pixels       | Declared preservation, target color and transparency behavior holds in specified regions.                                          |
| `prompt_fidelity`    | Optional vision judge       | Rendered artwork meets the case's visible requirements.                                                                            |

Render checks use 256-pixel images. Preservation compares RGBA pixels exactly;
transparency requires zero alpha; color checks require the target color within
a small tolerance on at least 1% of the selected region. These measure rendered
behavior rather than source-string similarity.

The visual judge sees a 512-pixel rendering on an opaque gray background. Editing
cases include before and after images. It returns pass/fail/uncertain verdicts
with evidence for each requirement. Fidelity is the fraction passed, except that
a failed critical requirement forces zero. Uncertain, incomplete or failed judge
responses remain unscored. The judge has a separate 60-second budget, 2,000 output
tokens and no retries. Its opaque image cannot establish transparency; alpha
checks do that separately.

A full pass requires every applicable required score to equal 1. Missing scores
remain incomplete, not zero or success. Generated cases without visual judging
cannot receive a full-case pass. Human ratings remain separate from automated
pass criteria.

### Reproducibility and reports

The CLI supports case/tag/split selection, custom datasets, drawing-model overrides,
paired reference comparisons and one to three sequential trials. Execution
concurrency is one. Each completed trial is saved immediately, preserving earlier
results if a later trial fails.

Artifacts live under ignored `evals/runs/<timestamp>/trial-NN/`: `results.json`,
completed SVGs, `review.html` and `human-reviews.yaml`. The run root contains
`comparison.json`. Curated committed historical examples live in
`evals/baselines/`.

Metadata records model IDs/settings, selected cases and hashes for data, agent,
policy, task, runner, scorers, renderer and judge prompt. Paired comparisons reject
incompatible datasets, selections or evaluator settings; drawing models may differ.
This separates a generator change from a changed measuring instrument.

Reports include full-case/category passes, policy false rejections, injection
resistance, missing scores, case-level regressions, latency, first-preview time,
tokens and observed score ranges. Up to three trials describe variation; they do
not establish statistical confidence. Calibration anchors and human evidence
must be checked before relying on judge scores as a quality signal.

### Human review

There are two implemented workflows:

- **Local review:** `npm run eval:review -- --serve` prepares existing runs and
  serves a loopback-only gallery. Explicit saves write `human-reviews.yaml`.
  Separate explicit synchronization can update an existing uploaded experiment.
- **In-app review:** `/eval-runs` lists uploaded experiments in the configured
  Braintrust project. Users with `admin-eval` review eligible completed outputs
  and save directly to Braintrust.

Both show the request and frozen safe artwork, plus the starting image for edits.
The scoring view hides model names, generator explanations and automated scores
so they do not anchor the reviewer. Local review renders at 768 pixels, which
is distinct from the judge's image format.

Human review records visual quality from 1 to 5, separate acceptability,
problem tags, notes, reviewer and skipped state. Quality measures execution within
the intended style: simple flat artwork can earn 5. Acceptability asks whether
that result fulfills the request well enough to deliver without correction.
A polished result can still be unacceptable if a requested feature is missing.

Ratings bind to the exact SVG SHA-256 hash. Unreviewed/skipped ratings remain
null. Braintrust stores quality divided by five and acceptability as 1/0, while
metadata preserves the rubric and full annotation. Null is not converted to zero.

For uploaded runs, Braintrust owns **one shared review per completed output**.
Explicit saves publish immediately and record the authenticated reviewer; saving
is not an independent vote per reviewer. The app restores existing reviews,
shows rated/skipped progress, preserves edits on save failure and advances only
after an accepted write. The decision removes dependence on the eval machine
and a separate sync step for uploaded-run review.

Local annotations remain local until explicitly synced. Sync verifies experiment,
case and exact output identity before updating rows, then verifies saved scores.
It cannot create an experiment for a local-only run. Human ratings do not
automatically train or calibrate the vision judge.

### Running evals

```bash
# Validate the current dataset without models or uploads.
npm run eval

# Run and visually judge holdout cases, saving three trials locally.
npm run eval -- --live --split holdout --trials 3 --judge

# Explicitly upload a live judged experiment.
npm run eval -- --live --judge --braintrust --name baseline

# Open existing local artifacts for human review.
npm run eval:review -- --serve
```

`--live` explicitly enables provider calls, `--judge` adds model-based visual
scoring, and `--braintrust` enables uploads. Unit tests mock providers and do not
spend API credits. See [the eval guide](../evals/README.md) for comparisons and
[human review instructions](../evals/HUMAN-REVIEW.md) for saving/synchronization.

## Development and deployment workflow

Local setup requires Node.js 22, npm, OpenAI credentials, a Clerk application and
Neon PostgreSQL with pgvector. Copy `.env.example` to ignored `.env.local` and
configure development credentials. Secrets remain server-side; public Clerk
publishable configuration is the expected exception. Use separate development
and production databases and identity configuration.

```bash
npm ci
npm run db:migrate
npm run dev
```

After schema changes, generate migration SQL, review it and explicitly apply it.
Builds and API requests never apply migrations. [README.md](../README.md) contains
full setup, environment variables and deployment steps.

Changes are formatted with `npm run format`. Application verification uses focused
existing tests, `npm test`, `npm run lint` and `npm run build`. Husky checks staged
formatting and JavaScript/TypeScript linting before commits; lint warnings block
commits. If the environment prevents Turbopack from building, the documented
fallback is `npm run build -- --webpack`. Google Fonts may require network access
for uncached builds.

Database integration tests require an explicitly configured disposable PostgreSQL
instance with pgvector and a database name beginning `svg_conversations_test`.
They drop/recreate and truncate tables. Browser fixtures use mock providers and
loopback-only test identity outside production routes. A separate Strict Mode
harness tests workspace effects and Blob resource lifecycles without a database.

Deployment targets Vercel with separate production configuration and explicitly
applied migrations. Generation routes require support for a 300-second duration;
collection processing uses 240 seconds. Authentication, owned persistence,
creation/editing, public/private access and downloads require deployment checks.
A successful local build alone does not demonstrate deployed behavior.

## Implementation timeline

Dates below are implementation history, not delivery promises. Commit subjects
and files establish when capabilities entered this repository; they do not
establish production launch dates.

| Date           | Milestone                                                                                                                       | Architectural significance                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 6 October 2026 | Next.js scaffold and server-only OpenAI setup.                                                                                  | Established the application and provider boundary.                                                                             |
| 7 October      | SVG workspace, validated generation, Clerk authentication/waitlist and reusable agent/token reporting.                          | Connected the user interface to authenticated model-backed artwork creation.                                                   |
| 8 October      | Initial visual baseline, iterative tools, progressive previews, execution details, bounded retries and Braintrust/vision evals. | Added observable tool-driven repair and a way to measure output quality; aligned generation timeouts with the hosting ceiling. |
| 9 October      | Tavily search, scope/content guardrails, social replies, English/Serbian copy, generation tracking and signed feedback.         | Separated policy and conversational handling from drawing; introduced optional external context and observability.             |
| 10 October     | Neon persistence, gallery and public result links.                                                                              | Made work resumable and specific completed versions shareable.                                                                 |
| 12 October     | Private collections, owner-scoped retrieval and model-default update.                                                           | Added indexed private references and explicit conversation privacy behavior.                                                   |
| 13–15 October  | Formatting/hooks, state/effect ownership refactors, clearer generation/retrieval naming and centralized model defaults.         | Made lifecycle behavior, call chains and conventions easier to maintain.                                                       |
| 1 November     | Further tool and eval-CI ideas recorded.                                                                                        | Captured proposals without implementing them.                                                                                  |
| 2–4 November   | Eval artifact consolidation, transparent-artwork judge visibility fix and local human review with Braintrust sync.              | Expanded evaluation beyond automatic scores and corrected rendering conditions.                                                |
| 6 November     | Admin Eval Runs directory, blind previews, direct shared Braintrust saves and review-progress/loading fixes.                    | Enabled uploaded-run review from the app across devices.                                                                       |
| 8 November     | Static-analysis cleanup.                                                                                                        | Removed findings without a new product milestone.                                                                              |
| 14 November    | Expanded reproducible trial reports and consolidated the 40-case challenge dataset with corrected expectations.                 | Strengthened coverage and comparison integrity; changed the evaluation baseline.                                               |

The [Braintrust review ADR](adr/0001-use-braintrust-for-in-app-eval-review.md)
records the source-of-truth decision. The [eval changelog](../evals/CHANGELOG.md)
records dataset/scoring changes relevant to interpreting historical runs.

## Plans and current limitations

This section separates recorded proposals from known limitations. It does not
assign priorities, deadlines or commitments. `TASKS.md` records plans and ideas;
it does not authorize implementation.

### Recorded proposals

| Proposal                         | Intended benefit                                                             | How to assess it                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted SVG editing tool        | Change selected parts without regenerating the entire source.                | Compare before/after evals, especially edit preservation, safety and tool behavior.                                                   |
| Rendered-image inspection tool   | Let the drawing agent inspect its SVG as a screenshot/PNG during generation. | Compare visual fidelity and defect correction alongside latency, tokens and repair bounds. Client/server placement remains undecided. |
| Eval-based CI merge checks       | Detect regressions before merging, with an explicit way to skip costly runs. | Define comparable baselines and pass policy; no committed workflow currently enforces this.                                           |
| Eval sleep/deadline improvements | Prevent misleading long local runs and settle stalled work more predictably. | Mock stalled operations and launcher cleanup before optional live verification. These are investigation proposals.                    |

The [timeout investigation](eval-timeout-investigation.md) connects historical
16–18 minute cases to macOS sleep. A suspended Node process cannot execute its
timeout callback. Separately, cancellation is cooperative: an awaited operation
that ignores abort can delay settlement even on an awake host. Proposed remedies
include live-run sleep prevention, an application-owned settlement deadline and
structured timing fields. These fixes are not implemented; another timer in a
sleeping process alone would not solve host suspension.

### Known gaps

- Ordinary generation has request bounds but no shared per-user rate/cost quota.
  Shared protection is needed before unrestricted access.
- The drawing agent cannot inspect rendered output and has no targeted patch
  tool. Vision is currently used for collection analysis and eval judging.
- There is no direct canvas editing, message editing/branching or conversation
  rename/delete UI.
- Generation has no durable background execution or reconnectable stream;
  collection scheduling stops when its page closes.
- Saved data has no automatic expiry. Ordinary public links have no separate
  revoke/expiry control; collection privacy is permanent.
- The app cannot launch evals or list local-only runs. Human reviews are shared,
  rather than separate ratings per reviewer.
- Judge calibration remains manual. Existing anchors and human review do not
  establish live judge accuracy or automatically improve the judge.

## Code map and supporting documentation

| Question                                    | Starting points                                                                                                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does the workspace start?             | [`app/page.tsx`](../app/page.tsx), [`svg-workspace.tsx`](../components/workspace/svg-workspace.tsx), [`use-workspace-session.ts`](../components/workspace/use-workspace-session.ts).                                                                                 |
| Where is generation orchestrated?           | [`route.ts`](../app/api/generate/route.ts) → [`conversations/generate.ts`](../lib/conversations/generate.ts) → [`handle-generation.ts`](../lib/ai/handle-generation.ts) → [`generate-svg.ts`](../lib/ai/generate-svg.ts) → [`svg-agent.ts`](../lib/ai/svg-agent.ts). |
| Where are policy, models and limits?        | [`input-policy.ts`](../lib/ai/input-policy.ts), [`config.ts`](../lib/ai/config.ts), [`generation-limits.ts`](../lib/workspace/generation-limits.ts).                                                                                                                 |
| Where are persistence and schema?           | [`store.ts`](../lib/conversations/store.ts), [`schema.ts`](../lib/db/schema.ts), [`drizzle/`](../drizzle/).                                                                                                                                                          |
| Where are SVG safety and display contracts? | [`lib/svg/`](../lib/svg/), [`lib/workspace/`](../lib/workspace/).                                                                                                                                                                                                    |
| Where are collection indexing and search?   | [`process.ts`](../lib/collections/process.ts), [`retrieval.ts`](../lib/collections/retrieval.ts).                                                                                                                                                                    |
| Where are evals and uploaded-run reviews?   | [`evals/`](../evals/), [`app/eval-runs/`](../app/eval-runs/), [`lib/eval-review/`](../lib/eval-review/).                                                                                                                                                             |
| Where are setup and commands?               | [`README.md`](../README.md), [`.env.example`](../.env.example), [`package.json`](../package.json).                                                                                                                                                                   |
| Which behaviors must changes preserve?      | [`agent-contracts.md`](agent-contracts.md), [`AGENTS.md`](../AGENTS.md), [`tests/`](../tests/).                                                                                                                                                                      |
| Where are proposals and vocabulary?         | [`TASKS.md`](../TASKS.md), [`GLOSSARY.md`](../GLOSSARY.md).                                                                                                                                                                                                          |

This overview explains the system as a whole. Supporting contracts define
behavior to preserve, setup instructions explain how to run it, and eval guides
define how to measure changes without confusing a revised evaluator with an
improved generator.
