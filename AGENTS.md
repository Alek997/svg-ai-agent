<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SVG AI Agent

## Purpose

Build a portfolio and interview project that turns a user's text prompt into a
clean SVG that closely matches their description, with a live preview in the browser.

## Working style

- Support the user's AI engineering learning goals: keep the implementation
  understandable and explain the reasoning behind meaningful decisions.
- Work in small, useful steps. Before each step, explain what will change and why.
- When creating a file or adding a dependency, explain its purpose and where it
  fits in the request flow.
- After each step, summarize the behavior added, how it was checked, and any
  remaining limitations.
- Explain unfamiliar AI and Next.js concepts in plain language. Document decisions
  that will be useful to discuss in an interview.
- Start with a working generation flow. Add agent loops, tools, and abstractions
  when there is a concrete problem they solve; explain the difference between a
  single model call and an agent that iterates using feedback.
- Keep changes focused on the current step. Avoid unrelated refactors and creating
  directories or infrastructure before they are needed.

## Current structure and conventions

- Use the existing Next.js App Router, TypeScript with strict checking, and
  Tailwind CSS. Keep the root-level `app/` structure and `@/*` import alias.
- `app/page.tsx`: main page; currently the starter screen.
- `app/layout.tsx`: shared layout, fonts, and page metadata.
- `app/globals.css`: global styles and Tailwind theme.
- `public/`: static assets; never put secrets here.
- Use npm and maintain `package-lock.json` with dependency changes.
- Read the relevant installed Next.js guides before writing application code. If
  `node_modules/next/dist/docs/` is missing, install dependencies first.
- Consult current official Vercel AI SDK and OpenAI documentation when selecting
  models or using SDK APIs. Do not assume examples from older SDK versions apply.

## Initial implementation

- Use the Vercel AI SDK with its OpenAI provider for model calls on the server.
- Start with a low-cost OpenAI model suitable for SVG generation. Verify current
  availability, pricing, and SDK compatibility before choosing the default.
- Keep the model choice configurable on the server, for example with
  `OPENAI_MODEL`, so experiments do not require rewriting the generation flow.
- Prefer a simple flow: prompt form → Next.js server route → streamed model
  generation → Zod validation and SVG safety checks → client-side live preview,
  source display, and download.
- Use Zod schemas for request inputs and generation results, with inferred
  TypeScript types. Enforce validation on the server even when the client also
  validates for immediate feedback.
- Use a Route Handler such as `app/api/generate/route.ts` for the server endpoint.
  Extract model and SVG helpers only as their responsibilities become clear.
- Show useful loading and error states, and reject empty or oversized prompts.
- Bound output size and model usage. Avoid unbounded retries or agent loops.
- Define clean output explicitly: valid standalone SVG with a `viewBox`, no
  Markdown fences, no executable content or external resources, and reasonably
  simple markup. Prompt instructions alone do not guarantee those properties.

## Secrets and generated SVG

- Keep `OPENAI_API_KEY` exclusively on the server. Read it from server environment
  variables and never expose it through client props, responses, logs, or browser
  bundles. Never use a `NEXT_PUBLIC_` prefix for secrets.
- Put local secrets in `.env.local`, which is already ignored by Git. Never ask
  the user to paste the API key into chat or commit a real key.
- When environment setup is added, commit a placeholder-only `.env.example` and
  explicitly allow that file in `.gitignore` while keeping real env files ignored.
- Mark shared modules that access secrets or call the model with `server-only`
  when they could otherwise be imported into client code.
- Treat model-generated SVG as untrusted input. Validate its XML/SVG structure and
  use an allowlist-based sanitization approach, rejecting scripts, event handlers,
  `foreignObject`, and external resource references. Regex alone is not sufficient.
- Integrate SVG parsing and safety checks with Zod refinements or transforms.
  A Zod string schema alone does not validate SVG markup or sanitize it.
- Preview only validated output in a restricted rendering context. Do not inject
  raw model output into the page with `dangerouslySetInnerHTML`.
- Download the same validated SVG used by the preview.

## Client-side live preview

- Render SVG in a Client Component and update the preview during generation.
- Start by evaluating an SVG `Blob` with MIME type `image/svg+xml`, exposed through
  an object URL to an `<img>`. This uses the browser's SVG image renderer without
  injecting markup into the page. Revoke obsolete object URLs on replacement and
  component unmount.
- Streaming chunks can end inside a tag or attribute. Do not treat each chunk as
  a valid SVG document. Prototype a bounded parser-based approach that builds
  standalone preview snapshots from completed elements, then validates and
  sanitizes each snapshot before rendering. Never repair markup using regex alone.
- Throttle preview updates and retain the last valid preview while the next
  snapshot is incomplete. Show generation progress before the first valid snapshot.
- Keep temporary preview snapshots separate from the final result. Validate the
  complete output on the server before allowing download or reporting success.
- Verify progressive rendering in the browser before claiming real-time preview
  works. Document any limitations discovered in the streaming prototype.

## Incremental roadmap

1. Install dependencies, read the relevant framework guides, and verify the starter.
2. Add the AI SDK, Zod, server-only model configuration, and environment setup docs.
3. Implement bounded streamed prompt-to-SVG generation, Zod schemas, and SVG safety
   checks on the server.
4. Prototype safe progressive SVG rendering, then add the prompt form, client-side
   live preview, SVG source, download, and loading/error states.
5. Evaluate a small fixed set of prompts for visual fidelity, SVG validity,
   latency, and cost. Use the results to guide model and prompt improvements.
6. Prepare the first deployment on Vercel. Configure secrets in Vercel environment
   settings and add appropriate request/cost protection before public access.
7. Explore a bounded generate–validate–repair agent loop once the basic flow works.

This roadmap is direction for future work, not a requirement to implement every
step in one change. Authentication, persistence, vector databases, and multiple
agents are outside the initial scope unless a concrete need emerges.

## Verification and documentation

- For application changes, run `npm run lint` and `npm run build` when dependencies
  are available. Report failures and checks that could not be run accurately.
- Check user-facing changes in the browser, including loading, failed requests,
  invalid SVG, and downloads where relevant.
- Add focused tests for important behavior such as input limits, SVG validation,
  and bounded repair attempts. Mock model responses for automated tests rather
  than spending API credits on every run.
- Keep `README.md` up to date as functionality is implemented: local setup,
  environment variables, architecture, verified model choice, and Vercel deployment.
- Never claim a live model call or deployed behavior was verified unless it was
  actually checked.
