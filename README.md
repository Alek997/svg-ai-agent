# SVG Studio

SVG Studio creates and edits SVG artwork through a conversational workspace.
Describe an icon, logo, illustration or diagram, watch validated drafts appear
in the canvas, and refine the result with follow-up messages. Completed artwork
is saved with its conversation and can be inspected, copied and downloaded.

## Features

- Progressive SVG previews, source view, zoom, copy and download.
- Saved conversations and an SVG gallery, with continued editing after reload.
- A bounded drawing agent that reads existing artwork, validates proposals and
  repairs invalid SVG within the same request.
- Optional web search for subjects the model does not understand.
- Public links to ordinary saved artwork and owner-only private collections.
- Private icon ingestion and hybrid retrieval to supply visual references.
- Execution details, generation token usage, and optional Braintrust tracking
  and user feedback.
- An evaluation suite with deterministic checks and optional visual scoring.

## Local setup

Use Node.js 22, npm, an OpenAI API key, a Clerk application, and a Neon PostgreSQL
connection. The database must support pgvector: the committed collection migration
requires it even when collection access is disabled.

```bash
npm ci
cp .env.example .env.local
```

Set the following values in `.env.local`:

```dotenv
OPENAI_API_KEY=<your OpenAI API key>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your Clerk publishable key>
CLERK_SECRET_KEY=<your Clerk secret key>
DATABASE_URL=<your Neon PostgreSQL connection string>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Use development Clerk keys and a development database locally, separate from
production. Configure the Clerk application for the local domain and desired
login providers. For invitation-based access, enable Waitlist mode in the Clerk
Dashboard; `/request-access` uses Clerk's Waitlist component and `/sign-up`
handles sign-up/invitation acceptance. These access settings live in Clerk.

Apply the committed migrations, then start the app:

```bash
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in. The first submitted
message creates a saved conversation at `/conversations/<id>`.

Migrations run explicitly, never during builds or API requests. After changing
`lib/db/schema.ts`, run `npm run db:generate`, review the SQL, and apply it with
`npm run db:migrate`. Use a separate database/branch for each environment.

## Configuration

[.env.example](.env.example) lists the supported application and evaluation
settings. Only model values are preset; fill in credentials and project settings
locally. Set the Clerk route variables to `/sign-in` and `/sign-up` in `.env.local`.
Restart the development server after changing settings.

| Variable                            | Purpose / default                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                    | Server credential for generation, moderation, policy checks, collection indexing and evals.        |
| `OPENAI_MODEL`                      | SVG generation model; defaults to `gpt-6-luna`.                                                    |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's browser-safe publishable key.                                                              |
| `CLERK_SECRET_KEY`                  | Server credential for Clerk sessions and capability checks.                                        |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | Sign-in route; set to `/sign-in` locally.                                                          |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     | Sign-up route; set to `/sign-up` locally.                                                          |
| `DATABASE_URL`                      | Server-only Neon PostgreSQL connection string.                                                     |
| `TAVILY_API_KEY`                    | Optional server credential for reference search.                                                   |
| `COLLECTION_DESCRIPTION_MODEL`      | Collection image-description model; defaults to `gpt-6-luna`.                                      |
| `COLLECTION_EMBEDDING_MODEL`        | Collection embedding model; defaults to `text-embedding-3-small`, with 1,536 requested dimensions. |
| `BRAINTRUST_TRACKING_ENABLED`       | App generation logging; disabled unless set to `true` with a Braintrust key.                       |
| `BRAINTRUST_API_KEY`                | Server credential for optional app logs or explicitly enabled eval uploads.                        |
| `BRAINTRUST_PROJECT`                | Braintrust project name; configure your own value locally.                                         |
| `BRAINTRUST_FEEDBACK_SECRET`        | Signing secret of at least 32 characters for feedback permissions.                                 |
| `EVAL_JUDGE_MODEL`                  | Eval judge selected with `--judge`; defaults to `gpt-6-luna`.                                      |

`OPENAI_MODEL` changes the drawing model only. Input policy separately uses
`omni-moderation-latest` and the `gpt-6-luna` Decisions model configured in
`lib/ai/input-policy.ts`. Collection description/embedding and evaluation judge
models have their own settings. Check provider access and model output limits
before changing models; the drawing cap is configured in
`lib/workspace/generation-limits.ts`.

Keep real credentials in ignored `.env.local` or deployment environment settings.
Only Clerk's publishable key and public route settings use `NEXT_PUBLIC_`.

## Architecture

The app uses Next.js App Router, React, strict TypeScript and Tailwind CSS.
Server-side generation uses the Vercel AI SDK and its OpenAI provider. Zod
validates request, stream and stored-data contracts. Drizzle manages typed SQL
against Neon PostgreSQL; pgvector stores collection embeddings. Saxes parses
SVG XML, and Sharp renders validated SVGs for collection indexing and evals.

```text
Chat message → Clerk authentication → owned conversation claim
  → server-loaded history and artwork → started stream event
  → moderation + scope/content/language classification
    ├─ social/clarification → database commit → text reply
    └─ artwork → optional collection retrieval → drawing agent
       → validated previews + persisted execution checkpoints
       → complete result validation → database commit → final result
```

Greetings, thanks, farewells and acknowledgements receive server-owned replies;
unclear artwork requests receive clarification. These preserve the current
artwork and do not run drawing tools. Reply copy supports English and Serbian
Latin/Cyrillic, with an English fallback. Actionable artwork requests proceed to
the drawing agent after policy approval; unrelated tasks and prohibited harmful
content are rejected.

The agent has three tools:

| Tool          | Responsibility                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `querySvg`    | Read the current validated SVG and a request-local revision.                                         |
| `validateSvg` | Validate a complete proposal and retain it as the request-local candidate; return errors for repair. |
| `webSearch`   | Retrieve bounded Tavily text snippets when the model does not understand the subject.                |

The model's final structured response contains a message and filename. The
server attaches the latest accepted SVG proposal and independently validates it
before saving. The model does not generate a second SVG in its final response.
A failed latest validation cannot finalize an earlier candidate.

Generation responses use newline-delimited JSON (`application/x-ndjson`). The
server emits `started`, followed by progress, activity, steps, tools, public
response text, previews, retrieval evidence and a terminal reply/result/error.
Policy checks occur after `started`, before drawing, tools or previews.
Failures after streaming begins are reported as stream events.

The browser updates its preview from standalone snapshots built at completed XML
element boundaries. Snapshots pass the SVG validator and are rendered as Blob
URLs in image elements. Temporary drafts cannot be downloaded. A failed request
restores the previous completed artwork; final success waits for the database
commit. Incomplete paths and definitions may not appear until a later snapshot.

### Persistence and access

Clerk supplies the authenticated user ID; the client cannot choose an owner or
submit model history as authoritative context. Every private resource read/write
checks ownership. Neon stores seven application tables: `conversations`,
`messages`, `svg_results`, `collections`, `collection_icons`,
`collection_references` and `collection_usage`.

Conversation revisions prevent conflicting submissions across tabs. Request IDs
support idempotent delivery, and each conversation permits one active generation.
Execution details checkpoint during the run. Accepted messages survive a
connection loss; unfinished runs are recovered on a later read/write after their
330-second lease expires. There is no detached generation job or reconnectable
live stream.

### Public SVG links

Ordinary saved results are accessible by public link at `/s/<publicId>` without
sign-in. Copying a link does not enable sharing; it is already enabled for those
results. Links identify a specific result, so later edits do not replace it.
Legacy UUID links continue to resolve.

`/api/public/svgs/<id>` returns only validated SVG source, with a generic filename
and `no-store`/`noindex` headers. It does not expose the conversation, owner,
usage or feedback. Text, titles and descriptions inside the SVG are part of the
shared source. Private conversations are excluded from anonymous reads.
There is no independent link expiry or revoke control for ordinary results.

### Private collections

Collections are disabled unless the authenticated user's Clerk **private
metadata** contains the `feature-rag` capability:

```json
{ "capabilities": ["feature-rag"] }
```

Preserve other metadata/capabilities when enabling it. The server checks private
metadata for collection pages/APIs and collection-based conversations.

Upload standalone SVG files, then select **Start indexing / Resume**. Ingestion
validates each SVG, renders a temporary transparent 256×256 PNG, generates a
structured description/tags, and embeds the searchable text. PNGs are not stored;
source hashes deduplicate files within a collection. Processing supports pause,
explicit stage retries and embedding reindexing; scheduling stops when the page
closes.

Select a searchable collection before creating a conversation. Retrieval combines
exact cosine similarity and PostgreSQL full-text ranking using reciprocal rank
fusion. Up to three complete SVG references fit within a combined 48,000-character
source budget. **Details** and the retrieval playground expose ranking evidence
and owner-only reference previews. Reference content remains untrusted input.

Collection-based conversations are private. **Add to collection** copies the
latest completed artwork and permanently makes its conversation private,
revoking all its public links and feedback permissions. Deleting the collection
preserves conversation privacy. Deleting icons/collections removes retained
reference source copies; already delivered browser copies cannot be recalled.

| Collection bound                   | Limit                                           |
| ---------------------------------- | ----------------------------------------------- |
| Collections per user               | 5                                               |
| Icons per collection               | 200                                             |
| Upload file size                   | 64 KB and the shared 48,000-character SVG limit |
| Icons claimed per processing batch | 5                                               |
| Attempts per processing stage      | 3, with explicit retries after failure          |
| Vision analysis attempts per user  | 200/day                                         |
| Retrieval searches per user        | 120/hour                                        |

Analysis/search quotas use UTC windows, count failed attempts, and are enforced
in database transactions across tabs and server instances. Embedding model changes
require explicit reindexing.

### Tracking and feedback

Braintrust app logging is optional and disabled by default. To enable it, configure
`BRAINTRUST_API_KEY`, set `BRAINTRUST_TRACKING_ENABLED=true`, and optionally set
`BRAINTRUST_PROJECT`. Enable rating controls with a `BRAINTRUST_FEEDBACK_SECRET`
of at least 32 characters, generated locally, for example:

```bash
openssl rand -hex 32
```

Logs contain message history, starting/final artwork, bounded tool activity,
status, successful generation token usage, and the Clerk user ID. The integration
does not fetch or log Clerk profile emails. User-entered content is logged as
submitted, including feedback comments. The workspace displays a recording notice.
Private runs skip generation tracking and feedback; making an existing ordinary
conversation private does not erase previously uploaded logs.

Feedback uses signed, owner-bound permissions that expire after seven days and
are checked against saved completed messages. Generation logging is best effort;
feedback reports upload failure so it can be retried. Braintrust access and
retention are configured separately. App logging and eval uploads are independent.

## Project structure

| Path                     | Responsibility                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `app/`                   | Workspace, auth, gallery, collections and public pages; API Route Handlers; layout/styles/app icons. |
| `components/`            | Interactive workspace, collections, public view and shared UI.                                       |
| `lib/ai/`                | Model configuration, input policy, drawing tools/streaming, tracking and feedback.                   |
| `lib/conversations/`     | Owned persistence, revisions, claims, checkpointing and client contracts.                            |
| `lib/collections/`       | Capability checks, ingestion, quotas, embeddings and hybrid retrieval.                               |
| `lib/db/` and `drizzle/` | Database client/schema and committed migrations/metadata.                                            |
| `lib/svg/`               | XML validation, progressive snapshots, safe rasterization and public-result reads.                   |
| `lib/workspace/`         | Shared generation contracts, limits, stream reader and UI state helpers.                             |
| `evals/`                 | Dataset, evaluation runner, deterministic scorers and optional vision judge.                         |
| `evaluations/`           | Saved baseline artifacts; generated runs under `runs/` are ignored by Git.                           |
| `tests/`                 | Mocked unit tests, disposable-database integration tests and browser fixtures.                       |
| `proxy.ts`               | Clerk session initialization; resource routes enforce their own authorization.                       |

`next.config.ts` keeps `ws` external on the server for the Neon driver's native
optional-module loading. No transaction stays open during model generation.

## Evaluation and tests

Formatting uses the pinned Prettier version and `.prettierrc.json`. Run
`npm run format` to format supported files, or `npm run format:check` to check
without editing. `npm run lint` checks ESLint rules and formatting;
`npm run lint:fix` applies ESLint fixes followed by Prettier.
VS Code workspace settings enable formatting on save with the recommended
Prettier extension. Dependencies, build output and local secrets are ignored
according to `.gitignore` and `.prettierignore`.

`npm install` or `npm ci` installs the Husky pre-commit hook through the
`prepare` script. Each commit checks staged files with Prettier and staged
JavaScript/TypeScript files with ESLint, including partially staged files.
Formatting failures, lint errors or lint warnings block the commit. Run
`npm run lint:fix`, review and stage the fixes, then retry the commit.
Use `npm run lint` to check the entire project.

Run the standard checks:

```bash
npm test
npm run lint
npm run build
```

Unit tests use mocked provider responses. If a restricted environment prevents
Turbopack's CSS worker from binding a port, use `npm run build -- --webpack`.
Uncached builds using Google Fonts require network access.

Integration tests require a **disposable** PostgreSQL database with pgvector whose
name starts with `svg_conversations_test`. They drop/recreate application tables
and truncate them between cases. Pass its connection string through
`TEST_DATABASE_URL` and run `npm run test:db`.

The manual browser harness also requires that disposable database, initialized by
`test:db`, and a Webpack build for CSS. Run `npm run test:browser:fixture` with the
same `TEST_DATABASE_URL`, then open
[127.0.0.1:4317/collections](http://127.0.0.1:4317/collections). It uses mock
providers and a loopback-only test owner, outside production routes. Synthetic
SVG fixtures are in `tests/browser/fixtures/`.

For standalone workspace and SVG resource lifecycle regressions, run
`node --import tsx tests/browser/effects-server.mts` and open
[127.0.0.1:4319](http://127.0.0.1:4319). The page runs React Strict Mode checks
with mocked network responses; it needs no database, authentication, or providers.

Validate the eval dataset without model calls:

```bash
npm run eval
```

Generate and visually score one case, optionally uploading the experiment:

```bash
npm run eval -- --live --case weather --judge --braintrust --name baseline
```

Only `--live` starts paid provider calls. `--judge` enables visual scoring and
`--braintrust` enables uploads. The runner evaluates the drawing engine directly,
without HTTP authentication, persistence, input-policy gating or private retrieval.
See [evals/README.md](evals/README.md) for configuration, scorers and comparisons.

## Deployment

1. Configure production Clerk keys, login providers, access mode and domain.
2. Configure a separate production Neon database with pgvector, then explicitly
   apply the committed migrations against that database before deploying.
3. Add required server environment variables to Vercel, plus any optional search,
   collection or tracking configuration used by that environment.
4. Confirm the target runtime supports the generation route's 300-second
   `maxDuration`; its generation deadline is 290 seconds. Collection processing
   requests use a 240-second route duration.
5. Verify authentication, ownership, generation/editing, saved conversations,
   public links and private collection behavior on the deployed domain.

Before unrestricted app access, add shared server-side generation rate/cost
protection. Per-request bounds and collection quotas are implemented; ordinary
SVG generation has no shared per-user rate/cost quota yet.

## Boundaries and limits

- Prompts: 1–2,000 characters. Selected message history: at most 20 messages and
  16,000 characters. Collection references are appended to the drawing prompt;
  current artwork is read through `querySvg`.
- Drawing: at most six model steps, 32,768 output tokens per step, two SDK retries
  for transient provider failures, and a shared 290-second generation deadline.
- Search: at most two Tavily attempts per generation, five bounded text results
  per attempt, and a ten-second search deadline. It provides text references,
  not image inspection.
- SVG: at most 48,000 characters, 1,000 elements, nesting depth 32 and positive
  viewBox dimensions up to 4,096. XML element/attribute allowlists reject scripts,
  event handlers, foreignObject, images, styles, hrefs and external resources.
- Validation checks SVG structure and safety, not visual accuracy. Generated
  visual content is not inspected or moderated by a vision model before display.
- Provider token counts describe successful drawing steps, excluding policy,
  search and collection work. Failed attempts may incur usage not shown in the UI;
  no dollar estimate is calculated.
- Saved data does not automatically expire. Conversation renaming/deletion,
  message editing and branching are not available in the UI.
