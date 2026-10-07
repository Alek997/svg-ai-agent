# SVG AI Agent

Turn a text prompt into a clean SVG, with a browser preview and conversation sidebar.

## Current behavior

Sending a chat message makes `POST /api/generate` with the user/assistant history
and, for edits, the current validated SVG. The server makes one bounded model call,
streams progress events, validates the finished SVG, and returns artwork plus a
short assistant reply. The canvas shows the last valid artwork while generation
runs, and updates only when the result passes validation. Preview, code, zoom,
and download use that same SVG. Failed requests show an error and a retry button.
Starting a new conversation cancels the active request and clears history/artwork.
History is in browser memory and resets on reload. The initial artwork is a sample.

Streaming currently reports progress, **not partially rendered artwork or streamed
assistant text**. Safe progressive SVG snapshots remain a separate future step.
There are no tools, automatic repair attempts, or agent loops. One model call
responds to each submission; manual retry starts another bounded call.

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
[`streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), and
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
- `components/workspace/`: canvas, chat, messages, composer, and request coordination.
- `lib/workspace/contracts.ts`: shared Zod request/response schemas and limits.
- `lib/workspace/generate-client.ts`: fetch and incremental NDJSON response reader.
- `lib/workspace/types.ts`, `sample.ts`: inferred UI types and authored sample.
- `lib/ai/model.ts`: server-only environment validation and model configuration.
- `lib/ai/generate-svg.ts`: server-only instructions and bounded SDK streaming call.
- `lib/ai/handle-generation.ts`: request validation, streaming transport, result
  validation, safe errors, cancellation. Model injection allows mocked tests.
- `lib/svg/validate-svg.ts`: strict XML parsing with `saxes` and Zod transformation.
- `tests/`: mocked request, SDK, stream-client, and SVG safety tests.

```text
ChatComposer → SvgWorkspace → POST /api/generate
  → Zod request validation + current SVG validation
  → server-only model call with server-owned instructions
  → progress events → XML validation + result schema
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
`result`, or `error` events. A result contains `message` and a `document` with
`name`, `description`, `source`, `width`, and `height`. Request errors return JSON
with an HTTP 400/413/415 status; errors after streaming starts are stream events.

## Trust and usage limits

Client history is editable, including forged assistant messages. It is context,
not proof of prior actions or authorization. The server accepts only user/assistant
roles, rejects additional fields, and owns the system instructions. Zod checks
structure, not truthfulness or immunity to prompt injection. Future server-owned
history would require authentication and conversation ownership checks.

- At most 20 messages, 2000 characters per message, 16000 total history characters.
- Request and response bodies capped at 96000 bytes; SVG strings at 48000 characters.
- One model call, no SDK retries, at most 8000 output tokens, 60-second generation
  timeout, and cancellation when the client disconnects. The browser times out
  at 70 seconds. Conversation limits ask the user to start a new conversation.
- Strict SVG element/attribute allowlists; positive `viewBox` dimensions up to
  4096; at most 1000 elements and nesting depth 32. Disallowed content causes the
  entire SVG to be rejected rather than silently altered.
- No scripts, event handlers, `foreignObject`, images, styles, hrefs, external
  URLs, namespace changes, DOCTYPE, XML declarations, or processing instructions.
  Gradients/masks/clips may refer only to local IDs using `url(#id)`.

The XML parser inspects structure and decoded attributes; regex is used only for
individual value restrictions. SVG validation is integrated into Zod transforms.
The image preview uses an SVG Blob URL, never `dangerouslySetInnerHTML`. Preview
and download share the same URL, revoked on replacement and unmount. The client
validates the server response contract; the authoritative SVG safety check runs
on the server. Unsupported SVG features intentionally fail validation.

## Verification

```bash
npm test
npm run lint
npm run build
```

Automated tests use mocked model responses and never spend API credits. They cover
payload limits/roles, history forwarding, SDK structured output and token limits,
malformed XML, executable/external content, safe local gradients, redacted errors,
timeouts/cancellation, and NDJSON records split across UTF-8 chunks.

Clerk browser checks verified a logged-out `/` visit redirects to sign-in, the
request-access form renders and rejects an empty email, and uninvited `/sign-up`
shows Access restricted. An unauthenticated `POST /api/generate` returned HTTP 401
with a sign-in error. No account was created and invitation delivery, successful
email/social login, and logout were not verified by the agent. The user subsequently
confirmed that authentication works locally. Clerk doctor confirmed
the linked development application and keys; production is not configured.
Lint and all 37 existing mocked tests passed. The default Turbopack build could not
bind its processing port in this environment; `npm run build -- --webpack` passed.

Earlier generation browser checks covered loading, disabled sending during generation, successful
canvas/chat updates using a temporary mock, invalid output retaining the last
valid artwork, and the real endpoint's missing-configuration error. The temporary
mock is removed from the final route. No live OpenAI generation was verified during these browser checks:
a local API key was not configured at that time. The in-app browser's download-event wait timed
out during the earlier UI check; a saved download file remains unverified.

The existing Google Fonts setup requires network access during production builds.
In restricted environments, the build may need permission for network/processing
ports, or `npm run build -- --webpack` as a fallback. The existing lint tooling
chain still has five high-severity audit entries; review them separately rather
than running `npm audit fix --force` and accepting a framework lint downgrade.

## Deployment and next steps

No deployment has been verified. Before public Vercel access, configure the server
secrets (including production Clerk keys), configure the production Clerk domain,
and enable email/password, social connections, and Waitlist mode there too.
Production social login needs your own provider OAuth credentials. Check login,
invitation acceptance, logout, and unauthorized API requests on the deployed domain.
Add request/rate/cost protection before public access. Current
bounds constrain individual requests; they do not enforce per-user quotas across
requests or server instances. The route requests a 65-second platform duration;
availability depends on the deployment plan.

Next steps: verify a live model response, evaluate fixed prompts for fidelity,
latency and cost, then prototype validated progressive SVG snapshots. A bounded
repair loop can follow if invalid output proves a concrete recurring problem.
