# Eval Runs and Human Review

## Problem Statement

SVG Studio's visual review tool runs from a separate local URL. A reviewer needs the machine that holds the run artifacts to open the tool, and ratings saved there reach Braintrust only after a separate sync. Authorized reviewers need to browse uploaded runs and score their SVGs from SVG Studio itself.

## Solution

Add **Eval Runs** to the workspace header for signed-in users with the Clerk `admin-eval` capability. The directory lists experiments from SVG Studio's configured Braintrust project and opens a blind human review screen for each run. Each completed SVG output has one shared review. An explicit save writes that review directly to Braintrust.

## User Stories

1. As an eval reviewer, I want an **Eval Runs** link in the workspace header so that I can open the directory from SVG Studio.
2. As an eval reviewer, I want the directory to list uploaded experiments from the configured project so that I can review them from any device with access to SVG Studio.
3. As an eval reviewer, I want runs sorted newest first so that I can find recent experiments quickly.
4. As an eval reviewer, I want to see each experiment's name, date, and review progress so that I can choose which run to open.
5. As an eval reviewer, I want skips shown separately so that I can distinguish them from rated outputs.
6. As an eval reviewer, I want to see the request and completed SVG so that I can assess the artwork against the actual prompt.
7. As an eval reviewer, I want to see the original artwork alongside the result for edit cases so that I can judge both the requested change and what the edit preserved.
8. As an eval reviewer, I want model names and automated scores hidden on the scoring screen so that I can make an independent assessment.
9. As an eval reviewer, I want to use the existing visual quality rubric and acceptability judgment so that I can distinguish execution quality from readiness to deliver.
10. As an eval reviewer, I want to use the existing problem tags, notes, and skip action so that I can explain my assessment or why a completed output could not be judged.
11. As an eval reviewer, I want failed generations excluded from scoring and review progress so that visual quality reflects completed outputs.
12. As an eval reviewer, I want to save a review in place or save and move to the next case so that I can work through a run efficiently.
13. As an eval reviewer, I want to reopen a run and see its Braintrust ratings, including ratings previously synced from the local tool, so that I can pick up where review stopped.
14. As an eval reviewer, I want one shared review per output and to see who last saved it so that authorized reviewers can work from the same assessment.
15. As an eval reviewer, I want the form to preserve my changes when a save fails so that I can retry without re-entering the review.
16. As a regular SVG Studio user, I want my Collections permission to be independent of eval access so that granting one capability does not grant the other.
17. As a project operator, I want direct URLs and review requests to require `admin-eval` so that an unprivileged user cannot read eval data or change a score.

## Implementation Decisions

- Use `admin-eval` in Clerk private metadata. Enforce it server-side for directory and review pages, preview data, and score writes. Hide the workspace header link when the user lacks the capability.
- Use Braintrust as the source of truth for uploaded runs and their shared human reviews. Resolve experiment and output identity server-side within the configured project before reading or writing an output. Keep Braintrust credentials on the server.
- Show the experiment name, date, and review progress on the newest-first directory. A completed output counts as reviewed when it has a saved quality score. Skipped completed outputs have a separate count. Failed generations do not enter the denominator.
- Preserve the existing blind scoring workflow and visual quality rubric. Show the request, completed SVG, and original artwork for edit cases. Keep model names and automated scores out of the scoring view and its client payload.
- Validate artwork before rendering previews. Associate each review with the exact completed SVG it assesses.
- Write only the selected output's human review when the reviewer clicks **Save review** or **Save & next**. Retain the existing Braintrust score names and rubric mapping. Use the authenticated reviewer identity for new saves.
- Show success after Braintrust accepts the write. Advance to the next case only after a successful **Save & next**. Preserve form edits and allow a retry when the write fails, including when Braintrust throttles the request.
- Load ratings already synced to Braintrust. Keep disk-only ratings available for manual migration. The in-app workflow requires no end-of-run sync.

## Testing Decisions

- Proposed primary seam is SVG Studio's authenticated eval directory and review flow, with Braintrust responses stubbed at the provider boundary. Exercise what a reviewer sees and what a save changes through the same entry points the app uses. Follow the existing browser fixtures and server-side capability tests.
- Verify link visibility, direct access and write authorization, project scoping, newest-first ordering, and progress calculations. Include a user with Collections access and without `admin-eval`.
- Verify that blind review shows the request and safe artwork for generation and edit cases. Check that model names and automated scores are absent from the scoring response and that failed generations cannot be visually scored.
- Verify that existing Braintrust ratings load, saves update only the selected output, and **Save & next** advances on success. Simulate a throttled or failed write and verify that the form retains the changes and stays on the same case. Reuse the local review and score-sync tests as prior art for score mapping and output identity.

## Out of Scope

- Listing local-only runs or automatically importing ratings saved only on disk.
- Independent ratings per reviewer or separate browse and score capabilities.
- Running evals, changing the rubric, or changing automated scoring from the app.
- An end-of-run sync action in SVG Studio.

## Further Notes

- The existing CLI review tool remains available for local-only runs.
- The first deployment is expected to have one user with `admin-eval`. The shared review model also supports additional authorized users.
