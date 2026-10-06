# SVG AI Agent

Turn a text prompt into a clean SVG, with a live preview in the browser.

## Current status

The Next.js starter and server-only model configuration are in place. SVG
generation, validation, and the live preview are the next implementation steps;
the home page currently shows the starter screen.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS
- Vercel AI SDK (`ai`) and its OpenAI provider (`@ai-sdk/openai`)
- Zod for configuration, and planned request/result validation
- Vercel for the first deployment

## Local setup

Use Node.js 22 LTS and npm.

```bash
npm ci
cp .env.example .env.local
```

Open `.env.local` locally and set `OPENAI_API_KEY`. Do not paste the key into chat
or commit it. `.env.local` is ignored by Git; `.env.example` contains only placeholders.

`OPENAI_MODEL` defaults to `gpt-4.1-mini` when omitted. This is an initial low-cost
testing choice, not yet evaluated for SVG quality. It supports streaming through
the Responses API. At setup time (October 6, 2026), standard text pricing is $0.40
per million input tokens and $1.60 per million output tokens. See the
[official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
for current pricing, capabilities, and account rate limits.

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). Restart the dev server after changing
environment settings.

## Structure and intended flow

- `app/page.tsx`: main page, currently the starter.
- `app/layout.tsx`: shared layout, fonts, and metadata.
- `app/globals.css`: global styles.
- `lib/ai/model.ts`: validates server configuration using Zod and creates the model
  through the OpenAI provider. The `server-only` import prevents client imports.
- `.env.example`: documented environment settings, without a real key.
- `AGENTS.md`: project conventions and incremental roadmap.

The planned flow is:

```text
Browser prompt form
  → Next.js POST /api/generate
  → server-only OpenAI model call
  → streamed output with Zod validation and SVG safety checks
  → client-side SVG preview and validated download
```

The endpoint and client components have not been implemented yet. The browser will
call the Next.js endpoint; only the server will access `OPENAI_API_KEY`. Never
prefix this key with `NEXT_PUBLIC_` or return it to the browser.

Zod will validate input and result contracts. SVG markup also needs parsing and
safety checks integrated into those schemas. Streaming may split tags across
chunks, so progressive preview will require valid, sanitized snapshots rather
than rendering each raw chunk.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

The starter uses `next/font/google` for Geist fonts. A production build needs
network access to Google Fonts; an offline environment can fail at that step.
No API key is required to build the app. Model configuration is checked when
`getLLM()` is called, and creating a model instance does not make an API call.

In a restricted environment where Turbopack cannot open its local CSS processing
port, `npm run build -- --webpack` is an alternative. Setup verification passed
lint, TypeScript, and the Webpack production build; the default Turbopack build
could not complete in this environment.

The setup audit reported five high-severity entries in the existing development
lint tooling chain, originating from `braces` via `micromatch` and `fast-glob`.
These need a focused dependency review. Do not use `npm audit fix --force` blindly:
its proposed fix at setup time downgrades `eslint-config-next` to version 14.

## Vercel deployment

When generation and preview are ready, configure `OPENAI_API_KEY` and optionally
`OPENAI_MODEL` in the project's Vercel environment settings. Keep the key server
side and configure the environments where generation should be available.
Request/cost protection is still required before opening the generator publicly.

No deployment or live OpenAI request has been verified yet.
