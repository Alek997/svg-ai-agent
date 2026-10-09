# SVG AI Agent

Turn a text prompt into a clean SVG, with a browser preview and conversation sidebar.

## Current behavior

Sending a chat message makes `POST /api/generate` with user/assistant history
and, for edits, the current validated SVG. A server-only AI SDK `ToolLoopAgent`
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
These display records are retained in browser memory with the reply and are not
included in subsequent model message history. Only the server-owned tools'
bounded inputs/results are forwarded; raw provider errors are never shown.
Temporary previews are separate from the saved document. Download and copy are
disabled during generation; only a complete validated result replaces the saved
SVG. Failed requests discard the draft, retain the last completed SVG, and offer
retry. The labeled **New icon** action starts a fresh conversation. If there is
history, artwork, a running request, or a nonempty draft, it first opens a native
modal explaining that discarding the current workspace cannot be undone. **Keep
working** receives focus; Escape also cancels. Confirming **Discard and start new**
cancels generation and clears the conversation, artwork, draft, error, and retry
state. An empty workspace resets without a confirmation.

A permanent note explains the one-icon limit and recommends downloading before
resetting or reloading. A `beforeunload` listener is attached only while there is
work to lose, requesting the browser's reload/close/navigation confirmation.
Browsers control that dialog's text and may omit it in some situations, especially
on mobile; it is a guard, not persistence. See
[MDN's beforeunload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).
Draft state lives in the workspace so an unsent message receives the same protection.
The native `<dialog>` provides modal focus containment and Escape behavior without
adding a dialog dependency.

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

History and artwork live in browser memory and reset on reload. `currentSvg` still
travels from browser to server on edit requests; eliminating that transfer would
require persisted, authenticated document storage. Revision counters reset per
request and are not cross-request concurrency control. Requests run sequentially
in the UI. No image-generation or visual-inspection model is used.

Progressive preview is an approximation: unfinished paths, text, and elements do
not appear until a completed-element checkpoint is available; unfinished gradients,
masks and clipping definitions can change the appearance of later snapshots.
The model may redraw a full revision rather than emit small patches. A malformed
later chunk retains the previous safe preview; it cannot produce a final success.

## Authentication

Clerk manages sessions and accounts; no application database is needed. The
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
  → server-only ToolLoopAgent (up to six steps, querySvg + validateSvg)
  → activity/progress/validated preview events → final XML validation + result schema
  → result event → assistant history + SVG image preview/download
```

Example request (UI-only message IDs and the welcome message are excluded):

```json
{
  "messages": [
    { "role": "user", "content": "Draw a mountain" },
    { "role": "assistant", "content": "Created a mountain illustration." },
    { "role": "user", "content": "Add a sun" }
  ],
  "currentSvg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">...</svg>"
}
```

The response is newline-delimited JSON (`application/x-ndjson`) with `progress`,
`activity`, `step`, `tool`, `response`, `preview`, `result`, or `error` events. Preview carries safe source and
dimensions; activity carries the current step and tool name. A result contains `message` and a `document` with
`name`, `description`, `source`, `width`, and `height`, plus server-supplied `usage`
with model and token counts. Usage is separate from model-generated output and is
not forwarded in conversation history. Request errors return JSON
with an HTTP 400/413/415 status; errors after streaming starts are stream events.

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
Tracing is enabled for eval runs only. Tests use mock responses; live fidelity,
cloud upload, and real experiment traces have not been verified by setup alone.
Read the [walkthrough](evals/README.md) for each part, extension examples, limits,
and how to compare experiments.

## Trust and usage limits

Client history is editable, including forged assistant messages. It is context,
not proof of prior actions or authorization. The server accepts only user/assistant
roles, rejects additional fields, and owns the system instructions. Zod checks
structure, not truthfulness or immunity to prompt injection. Future server-owned
history would require authentication and conversation ownership checks.

- At most 20 messages, 2000 characters per message, 16000 total history characters.
- Requests capped at 96000 bytes; responses at 1500000 bytes; SVG strings at
  48000 characters. Large preview updates are skipped when necessary to reserve
  320000 bytes for the final result.
- At most six model steps, two SDK retries for transient provider call failures,
  at most 32768 output tokens per step (196608 across six completed steps),
  a 290-second total generation timeout including retries, and cancellation
  when the client disconnects. The browser times out at 300 seconds. Shared limits
  live in `lib/workspace/generation-limits.ts`. Retried provider attempts may incur
  additional usage not reported in the final successful response; these bounds
  are not a billing quota. Conversation limits ask the user to start a new conversation.
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
secrets (including production Clerk keys), configure the production Clerk domain,
and enable email/password, social connections, and Waitlist mode there too.
Production social login needs your own provider OAuth credentials. Check login,
invitation acceptance, logout, and unauthorized API requests on the deployed domain.
Add request/rate/cost protection before public access. Current
bounds constrain individual requests; they do not enforce per-user quotas across
requests or server instances. The route requests a 300-second platform duration,
within Vercel Hobby's maximum with Fluid compute enabled. The generation deadline
is 290 seconds to leave room for response cleanup before the platform cutoff.

Next steps: verify live multi-step tool calling with the configured model, evaluate
fixed prompts for fidelity, latency and cost, and consider persisted document
storage if edits must survive reloads. Final metadata reuses the validated SVG,
so the model does not spend output tokens reproducing the accepted artwork.
