# Project tasks

## Clearer function names, argument names, and call chains

- Status: Completed — generation/retrieval naming refactor implemented.
- Priority: 2 out of 3 (medium).
- Problem: Generic names such as `generate`, `owner`, `input`, `options`, and
  `detail`, combined with long positional argument lists, make the request flow
  difficult to follow. Names should explain the action, data, or ownership check
  without requiring readers to trace several files.

The collection retrieval → SVG generation flow covers:

- `app/api/generate/route.ts`
- `lib/conversations/generate.ts`
- `lib/ai/generate-svg.ts`
- `lib/ai/svg-agent.ts`
- `lib/collections/retrieval.ts`

Work to do:

- [x] Replace generic function/callback names with names describing their actual
      responsibility, such as `generateSvgWithoutCollectionReferences` and
      `generateSvgWithCollectionReferences`.
- [x] Use consistent names for data passed between functions. For example,
      `detail` and `retrieval` currently refer to the same object; consider
      `collectionRetrievalContext` throughout that call chain.
- [x] Name arguments by purpose, such as `svgGenerationRequest`,
      `generationDependencies`, and `authenticatedUserId`. Use `collectionOwnerId`
      when the value represents stored collection ownership. Avoid ambiguous local
      names such as `owner` for a database query result.
- [x] Replace long positional parameter lists and repeated `undefined` arguments
      with named parameter objects where that makes call sites easier to understand.
- [x] Format dense one-line callbacks and functions into readable blocks. Keep
      related responsibilities together; avoid adding abstractions solely for naming.
- [x] Review other application flows for the same naming problems after the
      retrieval/generation flow is clear.

Acceptance criteria:

- A reader can follow request → retrieval → prompt assembly → generation directly
  from names and call sites, without guessing what an argument represents.
- Ownership-related names distinguish the authenticated user, persisted owner
  ID, and owner-scoped query result.
- Refactoring preserves behavior, authorization, privacy rules, API payloads,
  database schema, and model settings.
- Existing relevant tests, lint, TypeScript checks, and the production build pass.

Persisted database columns and public contracts retain their existing names.
Reusable primitives and already descriptive components retain their names.
The client workspace request/restore flow was reviewed and its ambiguous local
function and optimistic message ID names were clarified.

Verification: all 188 unit tests, TypeScript, lint, formatting, the isolated browser
regression suite, and the Webpack production build passed. The default Turbopack
build could not fetch Google Fonts. Database integration tests and live provider
calls were not run.
