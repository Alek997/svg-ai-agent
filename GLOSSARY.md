# SVG Studio

SVG Studio creates and edits SVG artwork through conversation. Evaluations measure how the generation workflow performs on a defined set of cases.

## Language

### Workspace

**Conversation**

A saved exchange of user messages and assistant responses, together with its completed artwork and generation attempts.

**Workspace session**

The current workspace interaction, including an unsent draft and any ongoing generation. A session can begin without a saved conversation and continue after creating one.

**Preview**

A provisional, validated SVG snapshot from an ongoing generation. It is separate from completed artwork and is not a completed download.

**Completed artwork**

A final SVG result that has passed server validation and been saved successfully.

### Evaluation

**Eval run**

One execution of a selected set of eval cases, with the resulting artwork and scores for each case.

**Braintrust experiment**

The record of an eval run uploaded to Braintrust.

**Human review**

The shared assessment of one completed SVG output, including its visual quality score and acceptability judgment.

**Human visual quality score**

A reviewer's rating from 1 to 5 of how well a completed SVG is visually executed. A separate acceptability judgment records whether the artwork is ready to deliver for the request.
