<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SVG Studio

Conversational SVG creation and editing. For architecture, entry points, features
and gaps, read [docs/project-overview.md](docs/project-overview.md).

## Before changing code

- Read the files involved and their tests. Preserve behavior, ownership, privacy
  and transport contracts unless the task explicitly changes them.
- `TASKS.md` records plans; it does not authorize work.
- For setup and configuration, use [README.md](README.md) and `.env.example`.
  Use `package.json` for commands and dependency versions.
- Before changing AI SDK APIs or model selection, check current official AI SDK
  and OpenAI documentation. The provider's Decisions integration is experimental.
- Read the applicable sections of [docs/agent-contracts.md](docs/agent-contracts.md)
  before changing generation, conversation persistence, public links, collections,
  tracking, feedback or evals. These sections define behavior to preserve.

## Implementation rules

- Use npm; update `package-lock.json` when dependencies change.
- Preserve App Router, strict TypeScript, Tailwind, root `app/` and `@/*` imports.
- Use Zod schemas and inferred types for requests, streams and stored results.
  Validate on the server even when the client also validates.
- Derive owner IDs from server-authenticated Clerk sessions. Scope private reads
  and writes to that owner; `proxy.ts` initializes sessions, not authorization.
- Keep credentials on the server. Use `server-only` in shared modules that access
  secrets or providers. Keep real keys in ignored `.env.local`; `.env.example`
  must contain placeholders and remain tracked. Never expose secrets in props,
  responses, logs, browser bundles or `NEXT_PUBLIC_` variables.
- Treat SVGs and retrieved content as untrusted. Use the XML parser, allowlists and
  `safeSvgSchema`; preserve size, dimension, element and depth limits, and local
  fragment-only references. Reject executable content and external resources.
- Render validated SVGs as Blob image URLs. Keep drafts separate from final
  artwork, retain the last safe preview and revoke obsolete URLs. Download only
  complete server-validated results. Never inject raw markup or repair XML with regex.
- Validate before Sharp rendering; preserve transparent padding.
- Apply reviewed migrations explicitly, outside builds and API requests. Keep
  development and production databases separate; keep dumps out of `drizzle/`.

## Verification and delivery

- Run `npm run format` for every change. Keep the Husky hook enabled; fix and stage
  formatting and ESLint failures before committing.
- For application changes, run focused existing tests, `npm run lint` and
  `npm run build`. If environment restrictions block Turbopack, report the failure
  and check `npm run build -- --webpack`.
- Add regression tests for safety, ownership, input limits, concurrency and bounded
  repair changes. Mock providers; automated tests must not spend API credits.
- Run database tests only against an explicitly configured disposable
  `svg_conversations_test*` PostgreSQL database with pgvector. They drop/recreate
  and truncate tables.
- Check user-facing changes in the browser, including loading, errors, invalid SVG
  and downloads when affected. Keep test-auth fixtures outside production routes.
- Report what changed, checks run and remaining limitations. Claim live calls,
  account settings or deployed behavior only when actually checked.
- Keep README about current functionality and setup. Preserve the generated
  Next.js instruction block above; `CLAUDE.md` delegates to this file.
