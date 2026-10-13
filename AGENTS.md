<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SVG Studio

## Purpose

Maintain SVG Studio, a conversational application for creating and editing SVG
artwork with safe progressive previews, saved conversations, public result links
and private reference collections.

## Working style

- Make focused, incremental changes. Explain meaningful decisions, new files and
  dependencies, how changes were checked, and any remaining limitations.
- Keep names and request flows understandable. Add abstractions, tools or
  infrastructure when they solve a concrete problem.
- Preserve existing behavior, ownership, privacy and data contracts during
  refactors. Planned work in `TASKS.md` is not authorization to start it.
- Keep README focused on current functionality, setup and supported claims.
  Avoid conversational history and unsupported verification claims.

## Structure and conventions

- Use npm and maintain `package-lock.json` when dependencies change.
- Format new and changed files with the pinned project Prettier version and
  `.prettierrc.json`. Run `npm run format` before finishing changes;
  `npm run lint` checks both ESLint rules and Prettier formatting.
- Keep the Husky pre-commit hook enabled. It checks staged formatting and ESLint
  rules; fix failures and stage the corrections before committing.
- Preserve Next.js App Router, strict TypeScript, Tailwind CSS, root-level `app/`
  and the `@/*` import alias.
- Read relevant installed guides in `node_modules/next/dist/docs/` before writing
  application code. Install dependencies first if those guides are missing.
- Check current official AI SDK and OpenAI documentation before changing SDK APIs
  or model selection. The provider's Decisions integration is experimental.
- `app/`: pages, API Route Handlers, shared layout/styles and custom app icons.
- `components/`: workspace, collection, public SVG and shared UI components.
- `lib/ai/`: model configuration, policy, tools, generation, tracking and feedback.
- `lib/conversations/`, `lib/collections/`, `lib/db/`: owned persistence, retrieval,
  quotas and database schema/client.
- `lib/svg/`, `lib/workspace/`: SVG safety, snapshots, rasterization, contracts and
  client state/stream helpers.
- `drizzle/`: SQL migrations and migration metadata. Never store database dumps here.
- `evals/`, `evaluations/`, `tests/`: evaluation code/artifacts and test fixtures.
- Preserve the generated Next.js instruction block at the top of this file.

## Generation flow

- Use the existing flow: Clerk authentication → owned conversation claim →
  server-loaded context → input policy → optional private retrieval → bounded
  drawing/validation agent → final validation and database commit.
- The saved-generation stream emits `started` before policy checks. Do not start
  drawing, tools or previews until policy approval.
- Keep generation on the server using the AI SDK/OpenAI provider. `OPENAI_MODEL`
  defaults to `gpt-6-luna`; policy, collection and judge models are independent.
- Create request-local tool state. Preserve the six-step bound, output limits,
  provider retry bound, timeouts and cancellation. Avoid unbounded repair loops.
- `querySvg` reads current artwork; `validateSvg` checks a complete candidate.
  Final metadata contains only message/filename, and the server attaches the
  latest accepted SVG. Never finalize after the latest proposal failed validation.
- Tavily search is optional, limited to two attempts, and supplies untrusted text
  references. Do not claim reference image inspection.
- Use Zod schemas with inferred types for requests, transport and stored results.
  Enforce validation on the server even when the client validates for feedback.
- Preserve useful loading/errors/retries and the previous completed artwork when
  generation fails. Final success must follow the database commit.

## Ownership and privacy

- Obtain owner IDs from server-authenticated Clerk sessions, never client input.
  Scope every private read/write to the owner. Proxy initialization alone is not
  authorization.
- Preserve conversation revision checks, request idempotency, claims and recovery.
  Do not hold a database transaction open during model generation.
- Ordinary saved results are public by link by default. Public reads return only
  validated SVG source and must exclude private conversations, including legacy IDs.
- Check `feature-rag` in Clerk private metadata for collection APIs/pages and
  collection-based conversations. Capability removal must not expose private SVGs.
- Adding a result to a collection permanently makes its conversation private and
  revokes public links/feedback permissions. Deletion preserves privacy and removes
  retained reference source copies.
- Private runs must not start Braintrust generation observers or accept feedback.
  Ordinary tracking is opt-in and identifies users by Clerk ID, not profile email.
  User-entered content can appear in logs; do not claim automatic redaction.
- Keep database-enforced collection quotas and explicit processing retries.
  Generation request limits are not shared user rate/cost quotas.

## Secrets and SVG safety

- Keep OpenAI, Clerk secret, database, Tavily, Braintrust and feedback credentials
  exclusively on the server. Never expose them through props, responses, logs or
  browser bundles, and never prefix secrets with `NEXT_PUBLIC_`.
- Keep local secrets in ignored `.env.local`. Never ask for keys in chat or commit
  real credentials. Keep `.env.example` placeholder-only and allowed in `.gitignore`.
- Use `server-only` for shared modules that access secrets or call providers.
- Treat generated/uploaded SVG and retrieved references as untrusted input.
  Use the XML parser and element/attribute allowlists through Zod validation;
  regex alone is not a sanitizer.
- Reject executable content and external resources. Maintain SVG size, dimensions,
  element count and depth limits; preserve local fragment-only references.
- Render only validated snapshots/final SVG as Blob image URLs. Never inject raw
  output with `dangerouslySetInnerHTML` or repair incomplete markup using regex.
- Keep drafts separate from final artwork. Throttle parser-based snapshots, retain
  the last safe preview, revoke obsolete URLs, and download only the complete
  server-validated result.
- Validate SVG before Sharp rendering. Preserve transparent padding in the shared
  renderer unless a requested change explicitly changes that contract.

## Database and verification

- Keep migrations reviewable and explicitly applied. Builds/API requests must not
  run them. Separate development and production databases.
- Run `npm run lint` and `npm run build` for application changes. If environment
  restrictions block Turbopack, report the failure and check the Webpack fallback.
- Run focused existing tests for relevant changes; add tests for important safety,
  ownership, input limits, concurrency and bounded repair behavior. Mock providers
  instead of spending API credits in automated tests.
- Integration tests require an explicitly configured disposable
  `svg_conversations_test*` PostgreSQL database with pgvector. They drop/recreate
  and truncate tables; never point them at development or production data.
- Check user-facing changes in the browser, including loading, failed requests,
  invalid SVG and downloads where relevant. Keep test-auth fixtures outside
  production routes.
- Keep eval configuration/comparisons reproducible. Document rendering/scoring
  changes and distinguish visual scoring from XML/safety validation.
- Never claim live provider calls, account settings or deployed behavior were
  checked unless they actually were. Report checks and limitations in the task
  response; keep public docs focused on current setup and behavior.
