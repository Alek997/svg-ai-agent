# Feature contracts

Read the sections affected by the task before editing. These rules supplement
[AGENTS.md](../AGENTS.md); architecture and feature status are in
[project-overview.md](project-overview.md).

## Generation and conversation persistence

Applies to `app/api/generate/`, `lib/ai/`, `lib/conversations/` and workspace
request, stream and preview handling.

- Preserve this order: Clerk authentication → owned conversation claim →
  server-loaded context → input policy → optional private retrieval → bounded
  drawing/validation agent → final validation → database commit → final success.
- Saved generation emits `started` before policy checks. Drawing, tools and
  previews start only after policy approval.
- Generate on the server through AI SDK/OpenAI. Model configuration lives in
  `lib/ai/config.ts`; drawing, policy, collection and judge models are independent.
- Keep tool state request-local. Preserve the six-step bound, output limits,
  provider retry bound, deadlines and cancellation in
  `lib/workspace/generation-limits.ts`. Repairs stay within the bounded loop.
- `querySvg` reads current artwork. `validateSvg` checks a complete candidate.
  Final model output contains only message/filename; the server attaches and
  validates the latest accepted SVG. A failed latest proposal cannot finalize
  an earlier candidate.
- Tavily supplies untrusted text references, with at most two attempts per run.
  Search results are not inspected images.
- Preserve revisions, request idempotency, claims, checkpoints and recovery.
  Keep database transactions outside model generation.
- Preserve loading, errors, retries and previous completed artwork on failure.
  Throttle parser-based preview snapshots; never publish incomplete markup.
- Per-request bounds are not shared per-user generation rate/cost quotas.

## Public results, collections and privacy

Applies to public pages/APIs, `lib/svg/public-*`, `lib/collections/` and any
conversation or result operation that changes visibility.

- Ordinary saved results are public by link by default. Public reads expose only
  validated SVG source and exclude private conversations, including legacy IDs.
- Enforce `feature-rag` in Clerk private metadata on collection pages/APIs and
  collection-based conversations. Removing capability must not expose private SVGs.
- Adding artwork to a collection permanently makes its conversation private and
  revokes public links and feedback permissions. Deleting collections/icons keeps
  conversations private and removes retained reference source copies.
- Preserve database-enforced collection quotas and explicit processing retries.
  Embedding configuration changes require explicit reindexing.

## Tracking and feedback

Applies to Braintrust generation observers, feedback APIs and rating controls.

- Private runs must not start generation observers or accept feedback.
- Ordinary generation tracking is opt-in. Identify users by Clerk ID, not profile
  email. User content may appear in logs; do not claim automatic redaction.
- Preserve signed, owner-bound, expiring feedback permissions and verification
  against saved completed messages. Making a conversation private does not erase
  previously uploaded logs.

## Evals and human review

Applies to `evals/`, `lib/eval-review/`, `app/eval-runs/` and review components.

- Read [evals/README.md](../evals/README.md) before changing datasets, runners,
  scorers or comparisons. Keep runs reproducible; document rendering/scoring
  changes. Distinguish XML/safety checks from visual scoring.
- Keep committed artifacts in `evals/baselines/` and generated output in ignored
  `evals/runs/`. Live provider calls and experiment uploads require explicit intent.
- For in-app review, read [the spec](specs/eval-runs.md) and
  [the Braintrust decision](adr/0001-use-braintrust-for-in-app-eval-review.md).
- Enforce `admin-eval` server-side for reads and writes, independently of
  `feature-rag`. Resolve runs and outputs within the configured Braintrust project.
- Braintrust owns uploaded runs and their shared reviews. Bind ratings to the exact
  output hash and authenticated reviewer. Keep model names and automated scores
  out of the blind scoring view and its payload.
- Save only on an explicit review action. Report success and advance only after
  Braintrust accepts the write; preserve form edits when saving fails.
