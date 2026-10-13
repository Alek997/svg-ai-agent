# Project tasks

## Clearer function names, argument names, and call chains

- Status: Planned — documentation only; do not start the refactor automatically.
- Priority: 2 out of 3 (medium).
- Problem: Generic names such as `generate`, `owner`, `input`, `options`, and
  `detail`, combined with long positional argument lists, make the request flow
  difficult to follow. Names should explain the action, data, or ownership check
  without requiring readers to trace several files.

Start with the collection retrieval → SVG generation flow:

- `app/api/generate/route.ts`
- `lib/conversations/generate.ts`
- `lib/ai/generate-svg.ts`
- `lib/ai/svg-agent.ts`
- `lib/collections/retrieval.ts`

Work to do:

- [ ] Replace generic function/callback names with names describing their actual
      responsibility, such as `generateSvgWithoutCollectionReferences` and
      `generateSvgWithCollectionReferences`.
- [ ] Use consistent names for data passed between functions. For example,
      `detail` and `retrieval` currently refer to the same object; consider
      `collectionRetrievalContext` throughout that call chain.
- [ ] Name arguments by purpose, such as `svgGenerationRequest`,
      `generationDependencies`, and `authenticatedUserId`. Use `collectionOwnerId`
      when the value represents stored collection ownership. Avoid ambiguous local
      names such as `owner` for a database query result.
- [ ] Replace long positional parameter lists and repeated `undefined` arguments
      with named parameter objects where that makes call sites easier to understand.
- [ ] Format dense one-line callbacks and functions into readable blocks. Keep
      related responsibilities together; avoid adding abstractions solely for naming.
- [ ] Review other application flows for the same naming problems after the
      retrieval/generation flow is clear.

Acceptance criteria:

- A reader can follow request → retrieval → prompt assembly → generation directly
  from names and call sites, without guessing what an argument represents.
- Ownership-related names distinguish the authenticated user, persisted owner
  ID, and owner-scoped query result.
- Refactoring preserves behavior, authorization, privacy rules, API payloads,
  database schema, and model settings.
- Existing relevant tests, lint, TypeScript checks, and the production build pass.

Do not rename persisted database columns or public contracts solely to improve
local variable names. No implementation work is included in this task yet.
