# SVG AI Agent

Turn a text prompt into a clean SVG, with a browser preview and conversation sidebar.

## Current behavior

Sending a chat message creates a conversation on first submission, then makes
`POST /api/generate` with its ID, the new prompt, an idempotency request ID, and the
expected conversation revision. The server loads history and the latest SVG from
Neon PostgreSQL. After sign-in and request validation,
server-side input policy checks classify the turn before streaming or tools start (see
the policy section below). Greetings, thanks, farewells and neutral acknowledgements
receive a short text-only reply through the same endpoint. Unclear artwork requests
receive a clarification question. These turns preserve the current SVG and download,
show checking activity only in chat, and never run the drawing agent, emit previews
or offer feedback. Only actionable artwork requests reach a server-only AI SDK `ToolLoopAgent`
can work across up to six model steps per request:

- `webSearch` looks up a subject through Tavily only when the model does not know
  or understand what the user is asking for. Understood requests go directly to
  drawing; being recent, niche, or a meme does not itself trigger search.
  Search results become context for the next model step.
- `querySvg` retrieves current SVG code and a request-local revision counter.
  The source is available through the tool instead of being inserted into the
  initial model prompt on every turn. Tool results still consume input tokens.
- `validateSvg` checks a proposed complete SVG using the XML safety validator.
  Failure returns a specific error so the model can repair and validate again.
  Success updates only the request-local candidate; it does not commit browser state.
- The model's final structured reply contains only filename and explanation.
  The server attaches the SVG accepted by the latest validateSvg proposal, then
  independently validates the complete result before committing it. A request
  cannot finalize without a successful proposal, or after its latest validation
  failed. This avoids generating and streaming a second copy of the same SVG.

SVG text streams inside validateSvg tool arguments; final response text streams
separately and cannot replay the drawing. The
server decodes the partial JSON string, parses XML, and builds standalone snapshots
at completed-element boundaries. It closes only containers observed by the parser,
then checks each snapshot with the same allowlist as final output. Updates are
throttled to 250 ms, with a final flush at step/tool-input boundaries. Unsafe or
incomplete snapshots are withheld; the browser retains the last safe preview.

Before the first snapshot, the initial canvas shows a skeleton and a Working
indicator. During edits the previous artwork remains visible until a safe draft
arrives. The canvas and chat show step/tool activity throughout generation. Each assistant
reply includes one small, muted Details text toggle. Its timeline appends events
in arrival order: model starts, tool preparation/calls, inputs, separate tool
results, public model response text, preview updates, model completion and the
final result or error. Parallel tools' results remain in their actual arrival
order. Consecutive public text updates are coalesced without moving across other
events. Preview entries show dimensions and size; final SVG source is inspectable
inside the final result. Expanding Details reveals the flow in a bounded scroll
area without large tool cards. It stays expanded as new events arrive. Calls appear while arguments are prepared, then update as tools
run and finish. Validation results show their returned valid flag and error;
failed requests retain the partial timeline and final error. Private model reasoning and raw provider metadata are
not exposed. Existing tool-only records remain available, but older unrecorded
model steps cannot be reconstructed.
These display records are persisted with the reply and restored when reopening
its URL. They are not included in subsequent model message history. Only the server-owned tools'
bounded inputs/results are forwarded; raw provider errors are never shown.
Temporary previews are separate from the saved document. Download and copy are
disabled during generation; only a complete validated result replaces the saved
SVG. Failed requests discard the draft, retain the last completed SVG, and offer
retry. The labeled **New icon** action opens a fresh workspace; saved conversations
remain in **Saved conversations**. The history list uses automatic titles from
first prompts and supports pagination. Reopening a conversation restores its latest
artwork, text, ordered Details timeline, errors, usage, and submitted feedback state.
The header's **My SVGs** link opens `/conversations`, a paginated gallery with each
conversation's latest completed SVG, title, filename, and update date. Cards reopen
the saved workspace; conversations without artwork remain accessible too. The
gallery has loading skeletons, an empty state, and retryable request errors. SVG
thumbnails use validated Blob images and are fetched only for gallery requests.
Saved workspace URLs show skeletons for both artwork and messages while loading,
including the route's server loading boundary. Starter artwork, welcome text, and
prompt suggestions appear only in a new workspace. Saved conversations without
an SVG show an empty canvas instead of the starter image.
Opening another user's conversation, or a missing conversation, returns to the new
workspace at `/` after the API rejects access. The rejected URL is replaced in
browser history. Temporary loading failures stay on the saved URL with an error
and a refresh action. Ownership remains enforced on every server read and write.
Earlier messages can be loaded in pages of ten. Intermediate SVG preview sources,
unsent drafts, and expanded/collapsed controls are temporary.

Navigation inside the workspace asks for confirmation only for unsent drafts or
active generation. A `beforeunload` guard covers those same cases; browser-controlled
dialogs may be omitted on mobile. Leaving interrupts generation. Accepted messages
and checkpointed run details survive; the previous completed artwork remains usable.
An unfinished run is recovered on the next read/write after its 330-second lease
expires. **Refresh saved conversation** checks its current state without polling.

The preview uses a Blob URL in an image element, never inline markup injection.
Its URL changes only when the exact SVG source changes. Finalizing an unchanged
preview removes the loader and enables download without reloading the image.
Code/Preview switches reuse the same URL; replacement and unmount revoke it.
Download is a visibly disabled native button during generation and iteration;
when the run finishes, it becomes a link using the existing image URL.
Code view, zoom and clipboard feedback remain available. Successful replies show
provider-reported token usage summed across all steps, including history and tool
results. Missing counts show Unknown. Failed requests do not show incurred usage.
No dollar cost is calculated. The model label is read-only.

History and artwork are server-owned. URLs use server-generated UUIDs, and every
resource read/write checks Clerk ownership. One generation can claim a conversation
at a time; revision checks prevent conflicting submissions across tabs. Tool revision
counters still reset per model request. SVG generation uses no image-generation or visual-inspection model. Private collection indexing separately describes temporary PNG renders.

Progressive preview is an approximation: unfinished paths, text, and elements do
not appear until a completed-element checkpoint is available; unfinished gradients,
masks and clipping definitions can change the appearance of later snapshots.
The model may redraw a full revision rather than emit small patches. A malformed
later chunk retains the previous safe preview; it cannot produce a final success.

## Conversation persistence and Neon setup

Use a Neon PostgreSQL database/branch for development and a separate one for
production. Keep Clerk; no duplicate user table or Clerk synchronization webhook
is needed. Store Clerk's opaque user ID as `owner_id`, obtained only on the server.

1. Create a Neon project and copy its PostgreSQL connection string into
   `DATABASE_URL` in `.env.local` (see `.env.example`). Never paste credentials into
   chat or use a `NEXT_PUBLIC_` prefix.
2. Run `npm run db:migrate` to apply the committed SQL migrations. The config loads
   `.env.local`; a missing connection string must be configured before migration.
3. Run `npm run dev`, sign in, and submit a prompt. Its URL becomes
   `/conversations/<server-generated-uuid>`. Reload and continue with an edit.
4. Set the production connection string in Vercel, apply migrations explicitly
   against that database, then deploy. Builds and API requests never run migrations.

`drizzle-orm` provides typed SQL and short PostgreSQL transactions; `drizzle-kit`
generates reviewable migration files. After changing `lib/db/schema.ts`, run
`npm run db:generate`, review the generated SQL, then migrate. The Neon serverless
WebSocket driver supports the row-locking transactions used for claims and writes.
Database pools are scoped to a database operation and closed after it completes;
no transaction stays open during model generation.

```text
Clerk auth() → owner ID
Conversation → ordered messages → assistant message → zero/one final SVG result
New prompt + IDs → owned conversation claim → server-built context → existing agent
Stream → serialized checkpoints → final SVG validation → DB commit → success
```

The three tables are `conversations`, `messages`, and `svg_results`. Scalar columns
support ownership, chronology, concurrency and pagination. Versioned Zod-validated
JSONB stores bounded display details. A final timeline entry references its SVG
result rather than duplicating the document. An SVG result's unique assistant-message
foreign key connects it to a conversation through `messages.conversation_id`.
Every restored SVG is safety-validated again before it reaches preview/download.

Saved artwork has a public link at `/s/<publicId>`, such as `/s/K7m2pR9xBc_A`. The workspace offers
**Copy public link** and **Public SVG** beside the Preview/Code toggle after saved
state is confirmed. The toolbar wraps on small screens; download stays in the
footer. Anyone
with a result's link can view and download it without signing in; this applies
to existing saved results too. Links refer to a specific result, so later edits
do not replace artwork behind an earlier link. The internal UUID remains unchanged;
no duplicate SVG storage is required. Migration `0001_public_svg_ids.sql` adds a
required, unique `public_id` and backfills existing rows using its random database
default. New results use the same default, including writes from the older app
during deployment. It encodes nine bytes of a random UUID as twelve URL-safe
characters (70 random bits after UUID variant bits). A unique index prevents
ambiguous links; an extraordinarily unlikely collision fails the write rather
than exposing another result. Existing `/s/<UUID>` links redirect to the short
link; the legacy SVG API also continues to accept UUIDs.

The separate public endpoint `/api/public/svgs/<publicId>` selects only `document.source`
and repeats XML safety validation. It returns SVG markup with a generic filename,
never the original prompt, conversation, owner, document description/name, usage,
or feedback data. The page has generic metadata and renders the SVG through a Blob
image. Text intentionally drawn inside the SVG is part of the shared artwork.
Public reads use `Cache-Control: no-store` and discourage search indexing.

Deleting a conversation cascades to its results. Missing, deleted, malformed-ID,
and unsafe results show **SVG unavailable** with a **Go to SVG Studio** link;
temporary storage failures offer **Try again**. Download rechecks storage to catch
deletion after the page was opened. An already viewed/downloaded copy cannot be
revoked. Links have no expiry or independent revocation control in this version.

Sharing verification: lint, TypeScript checking and 176 unit tests passed. Browser
checks used the real public/canvas components with mocked storage, confirming
loading, preview, download contents, missing/unsafe results, retry controls,
home navigation, copied-link feedback and deletion between preview and download.
All 11 database integration tests passed on disposable PostgreSQL 16, including
backfill of pre-migration artwork, default generation of new public IDs, legacy
lookup, stable links after edits, and cascade deletion. The default Turbopack build
was blocked by worker port binding restrictions in this environment; the production
build passed with `npm run build -- --webpack`. Apply `npm run db:migrate` before
deploying this code. The repository's existing Vercel Git integration publishes
merges to `main`.

Next.js loads `ws` as an external server package so its optional native modules
keep their Node.js loading behavior. Bundling it caused a `mask is not a function`
failure in the production webpack build. With this setting, the built app was
verified against the configured Neon database: backfilled short links rendered
artwork, UUID pages returned a 307 redirect, SVG reads returned 200 with `no-store`,
and missing-result reads returned 404. No live model call was needed.

API routes authenticate independently and send `Cache-Control: no-store`. Another
user's ID returns the same 404 as an unknown ID. List/detail reads are paginated;
client history responses have a 16 MB bound to account for SVG tool payloads.
The server accepts one run per conversation, deduplicates request IDs, and uses
expected revisions to reject conflicting tabs. Retries create new assistant attempts
for the same user prompt. Only the latest failed, retryable attempt can be retried.
Policy-rejected prompts remain visible, but are excluded from future context.

Before generation, both the user message and assistant placeholder must commit.
During generation, ordered display updates checkpoint no more than once per second
when events arrive; completion flushes immediately. A result is successful only after
its final database commit. If the browser disconnects, accepted messages survive;
partial details since the last checkpoint can be lost. Hard-killed processes leave
running records until the 330-second lease is reconciled on a later read/write.
A failed final save reports an error and retains the previous completed artwork.
There is no detached job or reconnectable live stream in this version.

Unsaved conversations from the former browser-only implementation cannot be
recovered. Drafts and intermediate preview sources are not persisted. Conversation
renaming, deletion, message editing and branching are deferred. Saved records do
not automatically expire. Storage and compute quotas still apply: measure actual
conversation sizes rather than treating the free plan as a fixed user allowance.

Future RAG can add Upstash Vector as a rebuildable index with references to Neon
records. Neon remains authoritative, and private retrieval must check ownership.
No vector indexing, embedding calls, or Redis dependency is added here.

Verification commands:

```sh
npm test
npm run lint
npm run build
# Disposable PostgreSQL database only: this test suite creates/truncates its tables.
TEST_DATABASE_URL=postgresql://<user>:<password>@<host>/svg_conversations_test npm run test:db
```

The integration suite requires a database whose name starts with
`svg_conversations_test`. It exercises real transactions, ownership, duplicate
requests, concurrent claims, restoration, recovery, pagination and feedback expiry.
Model responses remain mocked; no API credits are spent by these tests.

Verification on October 10, 2026: 169 mocked tests and 9 real local PostgreSQL
integration tests passed, including concurrent claims and timestamp-tie pagination.
The migration command was exercised on disposable local databases. Lint, TypeScript,
and the Webpack production build passed. The default Turbopack build was blocked by
environment restrictions on font downloads/worker port binding. Browser checks used
actual workspace components, a temporary PostgreSQL database, a mock model, and a
navigation adapter: loading, reload/direct URL restoration, continued edits, history,
invalid output, policy rejection, interrupted runs, and a downloaded SVG were checked.
An additional built-in browser pass verified successful retries after transient
failures, active-run blocking in another tab, stale-revision reconciliation with
draft preservation, browser Back navigation, SVG source view, and mobile layout
without horizontal overflow. Refreshing a saved conversation now retains an unsent
draft. No console warnings or errors were observed in that pass; the 169 mocked
tests, lint, and Webpack build passed again after the fix.
This does not verify a live Neon connection, Clerk session, model call, or deployment.
The gallery/loading follow-up passed the same 169 mocked tests and 10 local
PostgreSQL integration tests. Built-in browser checks covered delayed loading with
no starter-content flash, gallery-to-workspace navigation, empty saved canvases,
23 conversations across two pages, failed gallery requests followed by successful
retry, and mobile layout without horizontal overflow. These checks used the same
temporary mock-auth/model harness, rather than a live Clerk session.

## Authentication

Clerk manages sessions and accounts; Neon stores application data associated with
the server-authenticated Clerk user ID. The
workspace checks `await auth.protect()` on the server, and `/api/generate` checks
`await auth()` before starting generation, returning JSON with HTTP 401 when
unauthenticated. `proxy.ts` initializes Clerk for pages, API routes, and `/__clerk`.
Protect future private routes at the resource too; proxy alone does not restrict access.

Public routes are `/sign-in`, `/sign-up` (invitation acceptance), and
`/request-access`. The request page uses Clerk’s built-in Waitlist component.
Configure **Waitlist** in Clerk Dashboard → Access mode; a request grants no
access until an admin approves it and the visitor accepts the emailed invitation.
Existing users retain access. Approve requests in the Clerk Dashboard waitlist.
The workspace header includes a profile/sign-out button.

The connected development instance was verified to have email/password, Google,
and GitHub enabled with Waitlist mode. These settings live in Clerk, not Git.
Keep Email enabled for verification and invitation delivery.

## Reference search

`lib/ai/web-search.ts` wraps Tavily's Search API as an AI SDK tool using native
`fetch`, with no additional dependency. Only when the model does not understand
the requested subject does it choose a short query focused on identifying visual
features. It may set a day/week/month/year filter when recency matters.
The server fixes `topic=general`, `search_depth=basic`, `auto_parameters=false`,
five results, and two snippets per source; it does not request generated answers,
raw pages, or images. Searches are capped at two attempts per generation (including
failed and parallel calls), with no automatic retries, a ten-second deadline per
call, shared request cancellation, and a 100 KB response cap. After two attempts
the tool is removed from the remaining model steps. The overall six-step budget
still applies, so search leaves fewer steps for drawing and repair.

Results are validated, deduplicated and reduced to HTTP(S) source URLs without
credentials, titles up to 200 characters, and snippets up to 1500 characters.
The browser shows “Searching for references…” while the tool runs, then clickable
source links and plain-text snippets in the reply's Details timeline. Empty
results and safe errors appear there too. Provider bodies, credentials and raw
errors are never forwarded. Retrieved text remains untrusted context; it cannot
change tool permissions or SVG safety rules. SVGs still cannot embed remote assets.

This extends the existing agent loop: the model chooses a tool, sees its results,
then generates and validates the artwork. It does not add a separate research
agent or search every prompt. Search currently provides **text grounding**, not
image inspection; descriptions can help identify an obscure reference without
guaranteeing its visual likeness. Search selection depends on the model recognizing
that it does not understand the subject; this prompt-level rule is not a
server-enforced measurement of the model's knowledge.

Provider decision (October 9, 2026): [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
offers bounded snippets and date filters with a separate tool execution budget.
[Tavily pricing](https://docs.tavily.com/documentation/api-credits) lists 1000 free
credits/month and $0.008/credit pay-as-you-go; basic search costs one credit,
so two searches cost at most $0.016 at that rate, plus model tokens.
[OpenAI hosted search](https://developers.openai.com/api/docs/guides/tools-web-search)
would reuse the OpenAI key and is an alternative with provider-managed execution.
[Exa](https://exa.ai/docs/admin/pricing) offers real-time search, with instant
search starting at $4/1000 requests. No comparative relevance benchmark has been
run; Tavily was chosen for explicit per-request controls and the user's familiarity,
not a demonstrated advantage on memes. Compare providers on named-reference
prompts before changing the default.

Automated search tests mock Tavily and model responses to check budgets,
cancellation, unsafe URLs, response bounds, error redaction, and search → model
context → validation → final SVG. They do not establish live search relevance or
visual fidelity. Configure `TAVILY_API_KEY` on Vercel too when enabling search
there; token usage reporting excludes Tavily credits.

Verification on October 9, 2026: 84 automated tests passed, along with lint and
the production Webpack build (`npm run build -- --webpack`). The default
Turbopack build hit a local port-binding restriction in this execution environment.
Browser checks used actual workspace components with mocked API events to verify
search loading, clickable sources, escaped snippets, search failure, and retention
of saved artwork on invalid output. A separate live Tavily lookup and live agent
run using the locally configured `gpt-6-luna` completed in about 27 seconds:
one search, one rejected SVG attribute (`role`), successful repair/validation,
and a final beach illustration with a shark, three legs and blue sneakers.
This is one smoke check, not a comparative fidelity evaluation or verification
against a reference image. The default model remains `gpt-4.1-mini`.

## Private icon collections (feature-rag)

This is infrastructure for testing your chosen icons. No real collection has been
imported or embedded, and no user has been enabled automatically. The likely
future dataset is [Tabler's MIT outline icons](https://github.com/tabler/tabler-icons/tree/a4ce1404bc6d24d3c365afe7b258d6bf6f48d62d/icons/outline);
that link is a source note, not a seed/import command.

Apply the additive `drizzle/0002_private_collections.sql` migration with
`npm run db:migrate` to the intended development Neon database before enabling
access. It enables pgvector, adds collections/icons, counters and deletable
reference copies, and adds nullable collection selection plus a persistent
privacy flag to conversations. Existing conversations default to ordinary behavior.
This change prepares the migration; it does not apply it to your real database.

In Clerk Dashboard, set the chosen user's **private metadata** to include:

```json
{ "capabilities": ["feature-rag"] }
```

Preserve any existing capabilities. Missing metadata/entry disables the feature.
The server reads Clerk's private metadata, rather than trusting browser props or
public metadata. Pages/navigation and collection APIs are gated; creating,
opening and editing a collection-based conversation also checks the capability.
Capability removal never turns private artwork public. Historical artwork remains
owner-only even after its collection is deleted; deleting the collection clears
selection but preserves conversation privacy. No cross-user retrieval cache exists.

**Collections** appears beside **My SVGs** for enabled users. Create a name,
select standalone SVG files (no ZIPs), then **Start indexing / Resume**. Uploads
show per-file success/failure and duplicate detection. Cards show previews,
descriptions, tags, status, attempts, usage, explicit retries, reindexing and deletion.
Select one searchable collection or None before creating a conversation; the
selection is fixed. **Add to collection** copies the saved, server-validated latest
artwork and permanently makes all results in that conversation private, revoking
all public links. The UI explains this beside the action. Active generations cannot
be copied, preventing privacy/tracking races.

Every operation scopes data to the authenticated owner. Short public SVG IDs and
legacy UUID URLs both check the conversation's privacy flag. Private runs do not
start Braintrust observers, issue feedback tokens or upload feedback. Adding an
existing ordinary result revokes its old feedback permissions; previously uploaded
ordinary-run logs are not retroactively erased from Braintrust.

Ingestion is **XML allowlist validation → temporary 256×256 PNG → structured
image description/tags → batch embedding → searchable**. `sharp` is a production
dependency and the renderer is shared with evals. The same 48,000-character
allowlist applies, with an additional 64 KB file limit. PNGs are not stored.
Validated-source SHA-256 hashes deduplicate within a collection.
The temporary PNG preserves SVG transparency and uses transparent resize padding;
the shared renderer no longer adds or flattens onto a light gray background.
An actual background shape in the SVG remains part of the artwork. Description
version `png-description-v3` excludes empty space and viewer backdrops from search
metadata. Existing descriptions are retained; embedding reindexing alone does
not regenerate them. Live evaluation should include white and pale icons, whose
visibility may depend on how the vision service displays transparent images.

`COLLECTION_DESCRIPTION_MODEL` defaults to `gpt-6-luna` using OpenAI Responses,
structured output, `reasoningEffort: "none"`, `store: false`, a 300-token output cap,
30-second call deadlines and no provider retries. Official model documentation
checked October 11, 2026 lists image input, structured output and standard prices
of $0.10 input / $0.50 output per million tokens:
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
`OPENAI_MODEL` continues to configure the SVG generator independently.
`COLLECTION_EMBEDDING_MODEL` defaults to `text-embedding-3-small`, explicitly
requesting 1,536 dimensions. Embedding input includes filename, description and
tags. Model/dimensions/version and successful provider usage are stored; changing
embedding configuration requires explicit reindexing. Description quality and
real cost have not yet been evaluated.

A processing request claims at most five icons with a 240-second database lease,
uses at most two concurrent vision calls, persists descriptions before embedding,
then embeds the batch. The open browser schedules batches. Pause, unmount or page
close stops scheduling and cancels its request; already accepted provider work can
finish or be billed. Expired claims become explicit stage errors rather than
silently repeating paid work. **Retry failed stage** reschedules only that stage;
press **Start indexing / Resume** afterwards. Each failed stage has at most three
attempts. Ready icons can be explicitly reindexed without repeating vision.
A lost process may require waiting for the claim to expire, then refreshing and
retrying. There is no background worker or automatic repair loop.

Database-backed limits are five collections/user, 200 icons/collection, 200 vision
analysis attempts/day and 120 retrieval searches/hour. Windows use UTC; failed
analysis/search attempts consume quota. Collection row locks, claim IDs and atomic
usage upserts enforce bounds across tabs/server instances. Generator calls remain
subject to existing separate generation bounds.

Retrieval runs once after artwork-policy approval, using the initial artwork
request plus latest instruction without a rewriting model. Owner/collection
filters apply before exact cosine and PostgreSQL full-text rankings. Each ranking
returns ten candidates; equal-weight reciprocal rank fusion uses `k=60` with ID
tie-breaking. There is no approximate index. At most three complete validated SVGs
fit within a combined 48,000-character source budget; large candidates are skipped,
never truncated. Grid/stroke/fill observations common to at least half of searchable
icons support the examples. References/descriptions are untrusted visual data;
final SVG validation remains authoritative. Keyword matching uses PostgreSQL
`simple` full-text tokens and AND semantics, so long natural-language queries may
rely primarily on semantic matches.

The **Retrieval playground** uses the identical search function without drawing.
It and saved/streamed **Details** show the query, collection, descriptions, cosine
scores, semantic/keyword ranks, fused scores/ranks, selected source hashes,
observations and owner-only previews/source. Reference sources are stored separately
from message JSON; deleting icons or collections erases retained copies and Details
shows **Reference deleted**. Previously delivered browser copies cannot be recalled.

Implementation modules: `lib/collections/{access,store,process,providers,retrieval}.ts`;
APIs: `/api/collections`, `/api/collections/[id]`, and POST actions `upload`,
`process`, `retry`, `search`, `add-result`, `delete-icon`. Only the upload action
accepts bounded larger JSON bodies (five files/request, 700 KB total); the UI uploads
one file/request for visible partial progress. Errors expose no provider credentials
or raw provider messages.

Verification on October 11, 2026 uses mocked providers and synthetic SVGs/vectors:
187 unit tests and 25 real PostgreSQL/pgvector integration tests, lint, TypeScript
and the webpack production build. The default build was attempted: restricted font
access first, then the existing Turbopack port-binding restriction. Database tests
cover ownership, default-off capability injection, limits, concurrent claims,
stage retries, interrupted processing, hybrid ranking, persistence, deletion,
embedding incompatibility, public/legacy links and feedback revocation.
Browser checks use actual client components and server stores/stream handler in a
loopback-only harness, with a test navigation adapter and mocked policy/providers:
creation, partial upload rejection, progress, failed embedding, explicit retry,
pause/resume, playground, collection selection, generation, Details, safe preview,
matching download, add-from-result, private follow-ups, unsafe output and failed
requests. Browser automation stalled on a native deletion confirmation; deletion
and historical source removal are verified by the integration suite. Live Clerk
capability changes, real Luna/embedding calls, Neon migrations, measured fidelity,
latency/cost and deployed behavior are still unverified.

To reproduce synthetic browser QA, first build (for CSS) and run `test:db` against
a **disposable** `svg_conversations_test*` PostgreSQL database with pgvector, then:

```bash
TEST_DATABASE_URL=postgresql://.../svg_conversations_test_rag npm run test:browser:fixture
# Open http://127.0.0.1:4317/collections
```

`test:db` truncates its test tables. The fixture imports no real icons and makes
no external model/Braintrust calls; upload only `tests/browser/fixtures/*.svg`.
The unsafe fixture is intentionally rejected. `esbuild` is a dev dependency used
only to bundle the actual components for this isolated browser harness, which is
never mounted as a production Next.js route or authentication bypass.

After you supply the desired icons, inspect/import only those under your account,
then measure descriptions, retrieval relevance, style consistency, latency and
actual usage/cost. Compare no retrieval, semantic-only and hybrid results on fixed
requests separately from the infrastructure checks above.

## Local setup

Use Node.js 22 LTS and npm.

```bash
npm ci
cp .env.example .env.local
```

Set `OPENAI_API_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`
in `.env.local` locally. Retrieve the Clerk keys from your application’s dashboard
or run `clerk auth login` then `clerk init --app <your-app-id>`. Never paste secret
keys into chat, expose them with `NEXT_PUBLIC_`, or commit them. Only Clerk’s
publishable key belongs in `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. `OPENAI_MODEL` is optional and defaults to
`gpt-4.1-mini`. Restart the dev server after changing environment settings.

For web search, set the optional server-only `TAVILY_API_KEY` in `.env.local`.
Without it, ordinary generation still works; a requested search returns a clear
configuration error to the agent and Details. Never prefix this key with
`NEXT_PUBLIC_`. Search queries chosen by the model are sent to Tavily; the API key
is used only for server authentication.

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000).

The default is an initial low-cost choice, not evaluated for visual fidelity.
The [official GPT-4.1 mini documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
lists Responses API and structured output support, with standard pricing of
$0.40 per million input tokens and $1.60 per million output tokens at the October
6, 2026 documentation check. Actual account access and billing remain unverified.
The server uses the [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai),
[`ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent), and
[`Output.object`](https://ai-sdk.dev/docs/reference/ai-sdk-core/output).
Provider response storage is disabled with `store: false`.

## Project structure

The structure follows Next.js's documented "Store project files outside of app"
strategy. `app/` contains routes/layout; reusable UI lives in `components/`, and
shared contracts and helpers live in `lib/`. The page/header remain Server
Components; interactive components use `use client`.

- `app/page.tsx`, `app/layout.tsx`, `app/globals.css`: composition, metadata, styles.
- `app/api/generate/route.ts`: Node.js Route Handler for generation requests.
- `components/ui/`: reusable buttons and icons.
- `components/workspace/`: canvas, chat, messages, compact chronological execution details, composer,
  and request coordination.
- `lib/workspace/contracts.ts`: shared Zod request/response schemas and limits.
- `lib/workspace/generate-client.ts`: fetch and incremental NDJSON response reader.
- `lib/workspace/flow.ts`: preserves chronological event order for the conversation timeline.
- `lib/workspace/types.ts`, `sample.ts`: inferred UI types and authored sample.
- `lib/ai/model.ts`: server-only environment validation and model configuration.
- `lib/ai/input-policy.ts`: OpenAI moderation, Decisions
  classification, the shared product policy, and bounded failure handling.
- `lib/ai/web-search.ts`: server-only Tavily tool with request-local budgets and bounded source results.
- `lib/ai/svg-agent.ts`: server-only reusable agent factory, instructions, model
  output schema, request-local tools, step/token/retry limits, and conversation preparation.
- `lib/ai/usage.ts`: converts SDK token usage to explicit, nullable UI counts.
- `lib/ai/generate-svg.ts`: streams tool activity and validated draft snapshots with throttling
  and a character limit for the HTTP generation flow.
- `lib/ai/handle-generation.ts`: request validation, streaming transport, result
  validation, safe errors, cancellation. Model injection allows mocked tests.
- `lib/svg/validate-svg.ts`: strict XML parsing with `saxes` and Zod transformation.
- `lib/svg/progressive-svg.ts`: partial JSON string decoding and parser-based preview snapshots.
- `tests/`: mocked request, SDK, stream-client, and SVG safety tests.

```text
ChatComposer → SvgWorkspace → POST /api/generate
  → Zod request validation + current SVG validation
  → user-history moderation → scope/content/language Decisions check
  → server-only ToolLoopAgent (up to six steps, querySvg + validateSvg)
  → activity/progress/validated preview events → final XML validation + result schema
  → result event → assistant history + SVG image preview/download
```

Example public request (the server loads history and current SVG):

```json
{
  "kind": "message",
  "conversationId": "00000000-0000-4000-8000-000000000001",
  "content": "Add a sun",
  "requestId": "00000000-0000-4000-8000-000000000002",
  "expectedRevision": 1
}
```

Retries use `kind: "retry"` and `retryOf` (the latest failed assistant message ID)
in place of content, with a fresh request ID. They reuse the original user message.
Duplicate delivery of a request returns the existing run instead of calling the
model again. The internal generation engine and evals still use the bounded
`GenerationRequest` history shape; the public endpoint rejects that shape.

The response is newline-delimited JSON (`application/x-ndjson`) beginning with
`started` (conversation/user/assistant IDs and revision), followed by `progress`,
`activity`, `step`, `tool`, `response`, `preview`, `result`, or `error` events. Preview carries safe source and
dimensions; activity carries the current step and tool name. A result contains `message` and a `document` with
`name`, `description`, `source`, `width`, and `height`, plus server-supplied `usage`
with model and token counts. Usage is separate from model-generated output and is
not forwarded in conversation history. Request errors return JSON
with an HTTP 400/413/415 status. Once messages are saved, policy failures are terminal stream errors: policy
rejections set `retryable: false` and `excludedFromContext: true`; clarification
requests are text-only replies. The underlying engine still uses 422/503 internally.
Unauthenticated, invalid, conflicting, or unavailable-database requests fail before
streaming with HTTP 401/400/409/503. Errors after streaming starts are stream events.

## Input policy and guardrails

SVG Studio permits family-friendly icons, logos, illustrations, visual diagrams,
and edits, including contextual follow-ups and short labels belonging in artwork.
It rejects unrelated Q&A, essays, translations and programming tasks, including
attempts to wrap unrelated answers in SVG text, metadata or paths. Mixed requests
containing unrelated tasks are rejected; unclear visual requests ask for clarification
in chat without a generation error. Pure social messages are supported too. An actionable
artwork request takes priority over social wording: “Thanks! Make it blue” still edits,
while “thanks, it looks nice” leaves the artwork alone. Greetings attached to unrelated
questions or bypass attempts do not make those requests in scope.

The content policy focuses on serious harmful content: sexual exploitation and sexual
content involving minors; explicit sexual activity or pornography; terrorist or violent
extremist promotion and assistance; severe hate targeting protected groups; credible
threats and incitement; graphic gore; promotion or instructions for suicide, self-harm
or eating disorders; and actionable instructions for serious criminal wrongdoing.
Swearing, mild rudeness, obscene gestures, non-sexual nudity, and ordinary non-graphic
fictional violence are not independently prohibited. Educational, historical, medical,
anti-hate, prevention and recovery artwork is allowed when it does not promote harm.
For example, a suicide-prevention poster is allowed, while a suicide-instruction diagram
is prohibited. These are product decisions; classifier accuracy remains unmeasured.

Every valid generation request passes these checks before any stream is returned:

1. All submitted **user** messages are joined into one text input for
   `omni-moderation-latest`. Specific category flags are hard stops: `sexual`,
   `sexual/minors`, `hate/threatening`, `harassment/threatening`, `illicit/violent`,
   `self-harm/intent`, `self-harm/instructions`, and `violence/graphic`.
   The broad `flagged` aggregate, ordinary harassment, general self-harm mentions,
   non-graphic violence, and the base hate category do not independently reject a
   request. The content classifier still checks severe hate and harmful depictions.
   This rechecks user text from the server-selected recent history in one free moderation request. Assistant
   claims and artwork XML are excluded. Selected flags can still overblock benign
   discussion; category booleans are not perfect contextual judgments.
2. AI SDK `experimental_decide` with `openai.decisionModel('gpt-6-luna')` calls
   the native Decisions API. Independent scope, product-content and reply-language questions
   classify the latest message using the last four preceding messages, labeled
   untrusted, plus whether artwork exists. SVG source is not sent to the checker.
   Scope returns `allow`, `reject`, `clarify`, `greeting`, `thanks`, `farewell` or
   `acknowledge`; content returns `allow` or `reject`. Content must allow before any
   reply or generation. Only scope `allow` starts generation; social categories select
   server-owned replies, and `clarify` asks a question suited to artwork presence.
   Language chooses `en`, `sr_latn`, `sr_cyrl` or `other` in the same request. The latest
   user message determines the reply language/script; an ambiguous message uses recent
   user history. Assistant language does not set the preference. `other` falls back to
   English. Language selection grants no scope or safety approval.
   No confidence cutoff is invented before calibration.

There is no keyword blacklist: words such as “suicide” or “terrorism” can appear in
legitimate prevention artwork, and profanity alone does not trigger a local rejection.

The gate has a shared 15-second deadline, zero automatic retries, and request
cancellation. It shares the handler's overall generation deadline. Errors, native
refusals or malformed results fail closed with a generic 503; raw provider errors,
prompts, credentials and classification responses are not exposed or logged.
Selected moderation categories reject before Decisions.

The UI displays “Checking your request…” in chat during the gate; the canvas does
not show a generation loader or disable download until generation actually starts.
A rejected prompt remains visible but is omitted from subsequent requests, so a safe
next message can proceed. Clarification and social turns stay in conversation history,
so the next answer can refer to them. The previous completed artwork is retained. No retry button
is shown for a policy rejection; temporary failures remain retryable. Context
exclusion is persisted and enforced by the server.

After a retryable failure, the Retry button waits 15 seconds and shows a countdown.
The cooldown starts again after another failure and clears on a new request or new
conversation. This is a browser convenience only: it does not limit new submissions
or direct API requests, and it does not implement provider-aware or automatic retries.

The policy checker uses the existing server-side `OPENAI_API_KEY`. `OPENAI_MODEL` still
controls SVG generation; the checker separately uses `gpt-6-luna`, the currently
supported Decisions model. The provider is pinned at `@ai-sdk/openai@4.0.85`
because decision support is experimental. As checked October 9, 2026, Decisions
is in public beta and charges $0.10 per million input tokens, with no output or
cache charges. Moderation is free. Policy usage is **not included** in the UI's
generation-token counter. See the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions),
[AI SDK decision provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai#decision-models),
and [moderation guide](https://developers.openai.com/api/docs/guides/moderation).

### Accepted portfolio tradeoffs

Assistant history and artwork are now loaded from owned database records, while
user prompts and model content remain untrusted. Full saved history is not
reclassified on every request; user text in the selected recent context is
remoderated. The classifier sees bounded context, so very old references can need
clarification. Server-owned conversation history and ownership checks now enforce context
selection and access isolation. Agent instructions reinforce the policy, but prompt injection resistance
and semantic accuracy are not guaranteed.

These are **input** guardrails. XML validation prevents executable SVG, not harmful
visual content. Progressive previews, tool traces and final images do not undergo
visual/content moderation. For strict approval before display, buffer all generated
content and safely rasterize/inspect output before releasing it. Shared rate limits,
account restrictions and cost quotas remain separate work; this change does not add
them. The gate applies to the HTTP handler; direct agent/eval calls bypass it and
must explicitly call `checkGenerationPolicy` if input enforcement is needed there.

Mocked tests cover removal of the local word blacklist, selected moderation categories,
native Decisions request serialization, provider refusals, moderation of editable history, rejections,
clarification, deadlines, cancellation, malformed/oversized provider responses,
error redaction, and gating before generation. No live provider accuracy or billing
has been verified for these guardrails. Evaluate labeled English/Serbian requests,
follow-ups and adversarial prompts before claiming measured enforcement quality.

### Reusing the agent in server code and eval runners

`createSvgAgent()` builds the configured agent lazily, so importing the module
does not read credentials. Pass a model to `createSvgAgent(model)` to use a mock
or an alternative model with the same instructions, output schema, and limits.
`buildSvgMessages(input)` copies history without inserting SVG code. Supply
`input.currentSvg` to the factory so querySvg can retrieve it. Create a fresh
agent per request because tool proposal state belongs to that request.

```ts
import { buildSvgMessages, createSvgAgent } from "@/lib/ai/svg-agent";
import { generationRequestSchema } from "@/lib/workspace/contracts";
import { safeSvgSchema } from "@/lib/svg/validate-svg";

const input = generationRequestSchema.parse({
  messages: [{ role: "user", content: "Draw a blue circle" }],
});
const agent = createSvgAgent(undefined, input.currentSvg);
const result = await agent.generate({ messages: buildSvgMessages(input) });
const source = agent.getValidatedSvg();
if (!source) throw new Error("No validated proposal was completed");
const validatedSvg = safeSvgSchema.parse(source);
// result.output contains only message and filename.
// generateSvg() combines that metadata with the accepted SVG for the HTTP handler.
// result.totalUsage and result.steps are available for eval measurements.
```

Use `await agent.stream(...)` for streaming or `await agent.generate(...)` for
a complete result. Structured model output is not SVG safety validation: the
HTTP handler still validates the complete result, while other consumers must
validate inputs and SVG themselves before rendering. Both agent methods have a
290-second total timeout, a 32768-token cap per step, at most six steps, and up to
two provider retries per step for transient failures opening the stream. Retries
use SDK backoff and share the total deadline. Permanent errors, cancellation,
and failures inside an already-open stream are not automatically replayed; the
browser offers manual retry. Invalid SVG is repaired through validation feedback
within the existing six-step loop, not by restarting the request.
The HTTP streaming adapter additionally enforces its
384000-character cap across tool arguments and text and request cancellation.
Standalone Node runners need `--conditions=react-server` to import `server-only`
modules (as in `npm test`), plus alias resolution if using `@/` imports.

## Evals and Braintrust

An editable evaluation suite lives in [`evals/`](evals/README.md). Start with
`npm run eval` to validate the dataset without model calls. To generate, visually
score, and record one private Braintrust experiment, configure the placeholder
variables in `.env.example` in your local `.env.local`, then run:

```bash
npm run eval -- --live --case weather --judge --braintrust --name baseline
```

Cases are editable JSON, scorer functions are independent of Braintrust, and the
task reuses production streamed generation. Basic scorers check completion, safe
SVG, and tool protocol; the optional vision judge checks a fixed requirement
list. Local results and accepted SVGs are saved to ignored `evaluations/runs/`.
AI SDK telemetry is enabled for eval runs only; application tracking is configured
separately below. Tests use mock responses; live fidelity,
cloud upload, and real experiment traces have not been verified by setup alone.
Read the [walkthrough](evals/README.md) for each part, extension examples, limits,
and how to compare experiments.

## Production tracking and user feedback

Braintrust application logging is optional and off by default. In `.env.local`
(and Vercel's server environment settings when deploying), set:

```dotenv
BRAINTRUST_API_KEY=<your Braintrust API key>
BRAINTRUST_PROJECT=svg-ai-agent
BRAINTRUST_TRACKING_ENABLED=true
BRAINTRUST_FEEDBACK_SECRET=<a random secret of at least 32 characters>
```

Generate the feedback secret locally with `openssl rand -hex 32`; never paste
keys into chat, commit them, or prefix them with `NEXT_PUBLIC_`. Restart the app
after changing settings. The existing Braintrust package is now a production
dependency because API routes use it. Missing API keys or a disabled flag turn
application logging off; a missing/short feedback secret hides feedback controls
while generation logging remains available. Eval uploads still require their
separate `--braintrust` CLI flag.

Each saved conversation gets a server-generated UUID, retained across edits,
retries, reloads, and direct URL visits. The same ID groups Braintrust logs. Internal
eval inputs without an ID still receive a tracking fallback. IDs are identifiers,
not authorization: Clerk supplies the authenticated user ID, and database queries
check that user owns the conversation.

In Braintrust, open the project's **Logs** (rather than Experiments) to inspect
`svg-generation` traces. Filter metadata by `userId`, `conversationId`,
`environment`, or `status`. Logs contain submitted message history and starting
SVG, final independently validated artwork and explanation, model and summed
token counts on successful runs, and bounded tool inputs/results including search
queries and validation failures. Span duration records server run latency,
including policy checking. Valid requests rejected by policy and failed/cancelled
runs record safe errors/status; malformed or unauthenticated requests are not
logged. Tool activity is stored in root metadata in this initial version, rather
than separate model/tool spans. Partial previews, private reasoning, raw provider
errors, emails, credentials, and feedback tokens are not logged. Failed runs do
not currently report token usage; dollar cost is not calculated.

Completed generations display thumbs up/down with an optional comment, and an
optional reason for negative ratings. Sending feedback calls authenticated
`POST /api/feedback`; Braintrust receives `user_satisfaction` (1 or 0), comment,
and reason on the matching generation row through `logFeedback()`. A signed token
binds that row to its original Clerk user and expires after seven days. Modifying
the token, changing users, or rotating the signing secret invalidates it without
requiring a token database. Saved conversation feedback additionally checks that
its token belongs to the user's completed message. Tracking upload precedes marking
feedback saved in Neon, so an upload error cannot show a false saved state on reopen.
Feedback is only offered for complete validated results whose
SVG source differs from the submitted current artwork (or when creating the first SVG).
A quiet “Rate this SVG” row with thumbs up/down stays beneath that artwork response;
optional comment/reason fields open after selecting a rating. Social replies, clarification,
errors and unchanged results never receive feedback tokens or new rating controls.
Previous artwork responses retain their own controls when more chat messages arrive.
The UI disables repeat sends after success; resubmitting via the API updates the
same rating rather than preserving every submission. This is not a quota system.

Generation uploads are best effort and flushed through Next.js `after()` so a
Braintrust outage does not break drawing. Feedback waits for upload and reports
failure for retry rather than displaying false success. Braintrust's SDK can drop
failed batches; there is no durable retry queue. Concurrent upload failures can
conservatively report a feedback failure even if that feedback batch succeeded.
The workspace displays a recording notice when tracking is enabled. Clearing the
workspace does not delete Braintrust logs: configure retention/access in Braintrust
separately. These logs support developer review, not user-facing conversation
history. No online scorer or extra model call is enabled by this change; reviewed
failures can later become eval cases.

Implementation references: [Braintrust user feedback](https://www.braintrust.dev/docs/instrument/user-feedback)
and [TypeScript SDK](https://www.braintrust.dev/docs/reference/libs/nodejs).

Verification on October 9, 2026: 125 mocked tests, lint, TypeScript, and
`npm run build -- --webpack` passed. Default Turbopack build attempts encountered
restricted font access and then the existing CSS-worker port-binding restriction.
An isolated browser harness using copies of the actual workspace components
verified loading, positive/negative feedback, optional comments/reasons, failed
feedback and successful retry, independent generation tokens, retained conversation
IDs on edits/retries, a new ID after New icon, and no feedback for failed output.
The harness made no model calls or Braintrust uploads and changed no production
authentication route. Live Braintrust delivery and deployed behavior remain
unverified; configure the environment above and check a real generation and rating
in Logs before relying on production collection.

Feedback compatibility fix (October 9, 2026): Braintrust 3.37.1 issues hexadecimal
row IDs by default. Feedback tokens now treat signed row IDs as bounded opaque
strings, rather than requiring UUIDs. Regression tests use the SDK's actual ID
generator and cover generation → feedback submission, legacy UUIDs, ownership,
tampering, and expiry. Existing correctly signed tokens work after the fix; no
secret rotation or new generation is needed solely for this ID-format issue.

## Trust and usage limits

The public endpoint accepts only a new prompt or explicit retry reference, never
client-owned history, assistant messages, SVG source, or owner IDs. The server owns
context selection and system instructions. User prompts and stored model content
remain untrusted context; database persistence is not immunity to prompt injection.

- Model context uses at most 20 messages, 2000 characters per message, and 16000
  total characters. Older complete turns remain stored but fall outside the recent
  context window; no summarization model call is added.
- Public persistence/submission bodies are capped at 8000 bytes. Internal model
  requests are capped at 96000 bytes; generation responses at 1500000 bytes; SVG strings at
  48000 characters. Large preview updates are skipped when necessary to reserve
  320000 bytes for the final result.
- At most six model steps, two SDK retries for transient provider call failures,
  at most 32768 output tokens per step (196608 across six completed steps),
  a 290-second total generation timeout including retries, and cancellation
  when the client disconnects. The browser times out at 300 seconds. Shared limits
  live in `lib/workspace/generation-limits.ts`. Retried provider attempts may incur
  additional usage not reported in the final successful response; these bounds
  are not a billing quota. Recent-context selection allows saved conversations to continue.
- The token cap matches the default `gpt-4.1-mini` model's documented
  [32768-token output maximum](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
  The SVG character and element limits still apply. If changing `OPENAI_MODEL`,
  check its output limit and adjust `MAX_OUTPUT_TOKENS` if needed.
- Strict SVG element/attribute allowlists; positive `viewBox` dimensions up to
  4096; at most 1000 elements and nesting depth 32. Disallowed content causes the
  entire SVG to be rejected rather than silently altered.
- No scripts, event handlers, `foreignObject`, images, styles, hrefs, external
  URLs, namespace changes, DOCTYPE, XML declarations, or processing instructions.
  Gradients/masks/clips may refer only to local IDs using `url(#id)`.

The XML parser inspects structure and decoded attributes; regex is used only for
individual value restrictions. SVG validation is integrated into Zod transforms.
The image preview uses an SVG Blob URL, never `dangerouslySetInnerHTML`. Preview
and download share the same URL after completion, revoked on replacement and
unmount. Temporary previews cannot be downloaded. The client
validates the server response contract; the authoritative SVG safety check runs
on the server. Unsupported SVG features intentionally fail validation.

## Verification

For the October 10, 2026 inaccessible-conversation redirect, all 170 mocked tests
and lint passed. `npm run build` failed fetching Google Fonts in the sandbox;
the network-enabled Webpack build passed, including TypeScript (with disk-space
warnings for its cache). Browser checks used the actual workspace in a temporary
fixture: 403/404 opens redirected to `/` with an enabled composer, 503 retained
its error and refresh action, and New icon recovered from the failed open.
No live two-account ownership check was run. The temporary fixture was removed.

For the October 9, 2026 English/Serbian reply catalog change, 157 mocked tests, lint and
`npm run build -- --webpack` (including TypeScript) passed. The default build failed
fetching the existing Google Fonts in the sandbox; the Webpack fallback succeeded with
network access. Tests cover both Serbian scripts, ASCII Serbian, English fallback, clarification,
unchanged safety/generation routing, malformed language decisions and the native
three-question Decisions request in one call. Browser checks used the actual workspace
and handler in an isolated harness with mocked classifier results: English, Serbian
Latin/Cyrillic and fallback replies rendered correctly; the canvas image URL and download
remained available, with no new feedback controls. No live language-classification
accuracy or deployed behavior was verified. The temporary harness was removed.


For the October 9, 2026 conversational routing change, 140 mocked tests, lint and
`npm run build -- --webpack` passed, including TypeScript. The default build was
attempted but failed fetching the existing Google Fonts in the sandbox. The Webpack
build succeeded with network access. Native Decisions transport tests cover all
seven scope options and require a full probability distribution for those choices.

Routing uses the existing choice classifier ([OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions),
[AI SDK decide](https://ai-sdk.dev/docs/reference/ai-sdk-core/decide)), with no new
model call or dependency. Decisions chooses a category rather than composing prose;
server-owned replies keep casual turns bounded and unable to call tools. Replies now come from
`lib/ai/conversation-replies.ts`, a typed, extensible catalog for English and Serbian
Latin/Cyrillic. It covers greetings, thanks, farewells, acknowledgements and clarification
with/without artwork. Add a language ID, its classifier criteria and complete reply copy
in that file to extend it. Unsupported languages fall back to English.
Greetings briefly offer SVG creation/editing, without social check-in questions that
invite repeated small talk. Thanks and farewells remain brief closing replies;
clarification questions stay focused on SVGs.
This is a temporary approach: natural, context-aware conversations in many languages
would require a dedicated, bounded conversation-model call after classification, with
no SVG tools. The current approach adds one language question to the existing Decisions
call, not a new call or dependency. Interface labels, rejection/error text and the SVG
agent’s generated explanations are outside this reply catalog. Social turns still incur the existing moderation/classification
checks and enter stored history/recent context; they do not incur SVG agent usage.
No live classification evaluation was run for this change; mocked cases verify
routing, not whether the model reliably interprets every phrasing or mixed request.
Browser verification used copied workspace components and the actual HTTP handler
with mocked policy and generation providers in a temporary localhost harness. Checked
casual replies and clarification, no canvas generation loader during classification,
retained image/download during thanks, mixed thanks/edit generation loading, separate
feedback for the edited SVG, optional rating form and successful submission, no new
feedback on unchanged output, and retained validated SVG on invalid output or temporary
classifier failure. Downloaded contents matched the retained blue SVG. The harness
added no production route or authentication bypass and made no live model calls.


The Retry button cooldown was verified in an isolated browser fixture with mocked
503 and 422 responses: disabled countdown, re-enabling after expiry, restart after
another failure, and new-conversation reset. All 116 tests, lint and the webpack
production build passed after the change. Temporary fixture files were removed.

The October 9 policy revision removes the profanity blacklist, narrows automatic
moderation rejection to selected serious categories, and updates the shared classifier/
generator policy to allow benign sensitive-topic artwork. The composer hint now reads
“Family-friendly artwork only · Shift + Enter for a new line”. Earlier browser checks
below exercised the original stricter policy with mocks; they do not measure the revised
policy's live classification accuracy. For this revision, all 116 mocked tests, lint,
and the webpack production build (including TypeScript) passed.

For the October 9, 2026 input-policy changes, mocked tests, lint and TypeScript
checks passed, as did `npm run build -- --webpack`. The default build was attempted:
network isolation first blocked Google Fonts, then Turbopack hit the sandbox's
existing CSS processing port restriction. The webpack fallback succeeded with
network access for the existing fonts.

Browser checks used the actual workspace components and HTTP handler in an
isolated localhost harness with mocked moderation/classification/generation.
Verified the checking/loading state; profanity, off-topic and content rejections;
clarification; a retryable provider failure; safe follow-up after rejection;
retention of completed artwork on rejection or invalid output; and download
contents matching that retained validated artwork. All temporary harness files
were removed. Native moderation/Decisions request construction was tested with
mock HTTP responses; live provider judgments, deployed enforcement and classifier
accuracy remain unverified.

For the October 9, 2026 reset-confirmation changes, lint, all 84 mocked tests, and
`npm run build -- --webpack` passed. The default build was attempted but failed
on Google Fonts fetching in the sandbox; a network-enabled retry hit the existing
Turbopack CSS processing port restriction. Browser checks used the actual workspace
components in an isolated temporary harness with mock generation responses:
empty reset, draft confirmation, Keep working, Escape, initial focus, completed
artwork/download reminder, running-generation warning and cancellation, and a
failed request. Confirmed discard returned to the sample canvas and cleared
messages/draft/retry. Empty reload succeeded; reload attempts with work retained
the workspace, but the in-app browser did not expose the native warning text for
inspection. The harness added no production route or authentication bypass and
made no live model calls.

For the October 8, 2026 agent/preview and execution-details changes, 58 mocked tests, lint, TypeScript,
and `npm run build -- --webpack` passed. The default `npm run build` was attempted;
Turbopack could not bind its CSS processing port inside the sandbox. The missing
local official SWC compiler binary was restored for the build without changing
`package.json` or `package-lock.json`.

Tests cover multi-step query/validate/repair tool calls, tool results appearing in
subsequent model context, summed usage, termination after six tool-only steps,
preview delivery before the model finishes, every XML prefix boundary, partial
JSON escapes, malformed/unsafe drafts, transport preview safety, and response
budget reservation, alongside existing request, cancellation and client tests.
All model responses are mocked; automated tests do not spend API credits.

Browser verification used an isolated temporary mock-stream page (removed after
checking): the skeleton/loader appeared before the first preview, a circle rendered
first and a rectangle appeared in the next snapshot while generation remained
active, and tool/step status stayed visible. Copy/download were disabled during
generation. A final download was saved and its SVG contents matched the completed
mock document. Tool inspection was checked with a separate temporary mock page:
pending/running/completed status, input/results, validation feedback, retained
records, and toggles worked. The single Details section was also checked using a
temporary mock: collapsed by default, every model/tool step visible after expansion,
open state retained during updates, completed flow collapsible, and failure status
retained. The compact chronological timeline was browser-checked with a temporary mock:
small collapsed text toggle, expanded event order including public text and
previews, and open state retained through completion. All temporary mock pages
were removed. A follow-up sent the saved SVG; a failed draft restored the previous
completed artwork with retry available. The image-reuse check used another temporary mock canvas: finalizing and starting
an unchanged SVG preserved its URL and load count, downloading used that same URL,
changing source created a new URL, and Code/Preview reused the existing URL. The
mock page was removed. Tests also cover metadata-only final output, no preview
replay on the final step, missing validation and a failed latest proposal. No live
multi-step OpenAI call, visual fidelity evaluation, or deployed behavior was
verified for these changes.

```bash
npm test
npm run lint
npm run build
# Sandbox fallback if Turbopack cannot bind its processing port:
npm run build -- --webpack
```

Earlier Clerk checks verified logged-out redirects, request-access rendering,
restricted sign-up and an HTTP 401 for unauthenticated generation. The user
subsequently confirmed authentication works locally. Production Clerk is not
configured. These auth flows were not changed in this iteration.

The existing Google Fonts setup requires network during uncached production
builds. The lint dependency chain still reports five high-severity audit entries;
review those separately instead of forcing a framework lint downgrade.

## Deployment and next steps

No deployment has been verified. Before public Vercel access, configure the server
secrets (including production Clerk keys and DATABASE_URL), apply committed database
migrations to the production Neon database, configure the production Clerk domain,
and enable email/password, social connections, and Waitlist mode there too.
Production social login needs your own provider OAuth credentials. Check login,
invitation acceptance, logout, and unauthorized API requests on the deployed domain.
Add request/rate/cost protection before public access. Generation bounds constrain individual requests; SVG generation still needs per-user request/cost protection. Private collections enforce their own database-backed quotas across requests and server instances. The route requests a 300-second platform duration,
within Vercel Hobby's maximum with Fluid compute enabled. The generation deadline
is 290 seconds to leave room for response cleanup before the platform cutoff.

Next steps: verify live multi-step tool calling with the configured model, evaluate
fixed prompts for fidelity, latency and cost, and measure Neon storage/compute usage. Final metadata reuses the validated SVG,
so the model does not spend output tokens reproducing the accepted artwork.
