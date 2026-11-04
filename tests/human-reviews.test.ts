import assert from "node:assert/strict";
import { test } from "node:test";
import {
  humanReviewsSchema,
  matchHumanScoreRows,
  outputHash,
  parseHumanReviews,
  prepareHumanScores,
  reviewRunSchema,
} from "../evals/human-reviews";
import { reviewRubricVersion } from "../evals/review-artifacts";
import { verifyHumanScores } from "../evals/braintrust-reviews";

test("sync verification tolerates stale reads but stays bounded and does not confuse null with zero", async () => {
  const updates = [
    {
      id: "root",
      scores: { human_visual_quality: 0.8, human_acceptable: null },
    },
  ];
  let reads = 0;
  const waits: number[] = [];
  await verifyHumanScores(
    updates,
    async () => {
      reads++;
      return [
        {
          id: "root",
          scores:
            reads === 1
              ? { human_visual_quality: null, human_acceptable: null }
              : updates[0].scores,
        },
      ];
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(reads, 2);
  assert.deepEqual(waits, [500]);
  reads = 0;
  await assert.rejects(
    verifyHumanScores(
      updates,
      async () => {
        reads++;
        return [
          {
            id: "root",
            scores: { human_visual_quality: 0.8, human_acceptable: 0 },
          },
        ];
      },
      async () => {},
    ),
    /expected human scores/,
  );
  assert.equal(reads, 6);
});

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
const item = {
  id: "circle",
  tags: ["generation"],
  input: { messages: [{ role: "user", content: "Draw a circle" }] },
  expected: { requirements: ["Circle"] },
};
const run = reviewRunSchema.parse({
  summary: {
    projectId: "00000000-0000-4000-8000-000000000001",
    experimentId: "00000000-0000-4000-8000-000000000002",
    experimentName: "test",
  },
  results: [{ input: item, output: { status: "completed", source } }],
});
const review = {
  case: "circle",
  output_sha256: outputHash(source),
  quality: 2,
  acceptable: false,
  problems: ["structure"],
  notes: "Broken outline",
  skipped: false,
};
const document = {
  rubric_version: reviewRubricVersion,
  reviewer: "Reviewer",
  reviews: [review],
};
const remote = {
  id: "remote-root",
  span_parents: [],
  input: run.results[0].input,
  output: run.results[0].output,
  scores: { safe_svg: 1 },
};

test("human ratings map to independent score columns; zero is reserved for an actual No", () => {
  const [plan] = prepareHumanScores(run, humanReviewsSchema.parse(document));
  assert.deepEqual(plan.scores, {
    human_visual_quality: 0.4,
    human_acceptable: 0,
  });
  assert.equal(plan.metadata.humanReview.quality, 2);
  assert.equal(plan.metadata.humanReview.notes, "Broken outline");
  const [update] = matchHumanScoreRows([plan], [remote]);
  assert.equal(update.id, "remote-root");
  assert.ok(!("safe_svg" in update.scores));
});

test("missing, partial and skipped human ratings remain null, never zero", () => {
  for (const reviews of [
    [],
    [{ ...review, quality: null, acceptable: null }],
    [{ ...review, quality: null, acceptable: null, skipped: true }],
  ]) {
    const [plan] = prepareHumanScores(
      run,
      humanReviewsSchema.parse({ ...document, reviews }),
    );
    assert.deepEqual(plan.scores, {
      human_visual_quality: null,
      human_acceptable: null,
    });
  }
  const [partial] = prepareHumanScores(
    run,
    humanReviewsSchema.parse({
      ...document,
      reviews: [{ ...review, acceptable: null, quality: 1 }],
    }),
  );
  assert.deepEqual(partial.scores, {
    human_visual_quality: 0.2,
    human_acceptable: null,
  });
});

test("review validation rejects invalid ratings, duplicate cases/keys, skipped scores and missing reviewer", () => {
  for (const quality of [0, 6, 1.5, "2", false])
    assert.equal(
      humanReviewsSchema.safeParse({
        ...document,
        reviews: [{ ...review, quality }],
      }).success,
      false,
    );
  assert.equal(
    humanReviewsSchema.safeParse({ ...document, reviews: [review, review] })
      .success,
    false,
  );
  assert.equal(
    humanReviewsSchema.safeParse({ ...document, reviewer: "" }).success,
    false,
  );
  assert.equal(
    humanReviewsSchema.safeParse({
      ...document,
      reviews: [{ ...review, skipped: true }],
    }).success,
    false,
  );
  assert.throws(() => parseHumanReviews("reviewer: A\nreviewer: B\n"));
  const parsed = parseHumanReviews(
    `rubric_version: ${reviewRubricVersion}\nreviewer: Human\nreviews:\n  - case: circle\n    output_sha256: ${outputHash(source)}\n    quality: null\n    acceptable: false\n    problems: []\n    notes: |\n      A multiline\n      observation\n    skipped: false\n`,
  );
  assert.equal(parsed.reviews[0].acceptable, false);
  assert.equal(parsed.reviews[0].notes, "A multiline\nobservation\n");
});

test("matching refuses changed outputs, wrong cases, missing and ambiguous remote rows", () => {
  const parsed = humanReviewsSchema.parse(document);
  assert.throws(
    () =>
      prepareHumanScores(run, {
        ...parsed,
        reviews: [{ ...parsed.reviews[0], output_sha256: "a".repeat(64) }],
      }),
    /hash mismatch/,
  );
  assert.throws(
    () =>
      prepareHumanScores(run, {
        ...parsed,
        reviews: [{ ...parsed.reviews[0], case: "other" }],
      }),
    /no completed output/,
  );
  const plan = prepareHumanScores(run, parsed);
  assert.throws(() => matchHumanScoreRows(plan, []), /one matching/);
  assert.throws(
    () => matchHumanScoreRows(plan, [remote, { ...remote, id: "duplicate" }]),
    /one matching/,
  );
  assert.throws(
    () =>
      matchHumanScoreRows(plan, [
        { ...remote, output: { ...remote.output, source: source + " " } },
      ]),
    /output differs/,
  );
  assert.throws(
    () => matchHumanScoreRows(plan, [{ ...remote, span_parents: ["parent"] }]),
    /one matching/,
  );
});
