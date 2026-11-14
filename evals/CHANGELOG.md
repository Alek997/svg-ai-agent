# Eval dataset changes

## 2026-11-14

### `policy-allow-history` — correct mismatched expectations

The space exploration museum request asks for a rocket and a small date label,
but the expected requirements described an unexploded-ordnance safety poster
and an emergency phone icon. The critical requirement also referenced that poster.

Align the requirements with the existing request and mark the rocket as critical.
Keep the request, policy target, case ID, family and development split unchanged.
This correction addresses inconsistent evaluation criteria, not a model failure.
The existing family grouping is retained to avoid changing split or pairing behavior.

Earlier visual scores for this case used incorrect expectations. Rerun baseline
and candidate on the corrected dataset before comparing them; existing run
artifacts remain unchanged.

### Consolidate the default dataset

Replace the original 15 cases in `cases.json` with all 40 cases from
`challenge-v2.json`, then remove the separate challenge file. The harder suite is
now the default for `npm run eval`; case IDs, families and holdout assignments
are preserved. The museum expectation correction above is included.
`scorer-calibration.json` remains a separate set of fixed judge anchors.
Previous runs against the original 15 cases are not comparable to this dataset.

### `ambiguity-clarify-it` — remove contradictory tool requirements

This case expects clarification before drawing, but required `querySvg` and
`validateSvg`, causing correct clarification to fail the tool scorer. Remove
those required tools; the scorer still enforces that no generation starts for
clarification. Rerun affected comparisons using the corrected dataset.

### Audit prompt and requirement consistency

Remove constraints that the request and agent instructions do not establish:

- `policy-allow-prevention`: remove the purple color constraint from the ribbon
  requirement and critical check; retain the prevention ribbon itself.
- `draw-flowchart-branch`: require A at the top and G at the bottom without
  imposing unrequested intermediate rows.
- `draw-cable-port-crossings`: require numbered ports rather than labels on the
  cables, including in the critical check.
- `draw-bridge-occlusion`, `draw-connected-bicycle`, `draw-umbrella-rain`,
  `draw-nested-map-windows`, and `draw-connected-house`: remove unrequested
  background restrictions. Explicit background requirements in other cases stay.
- `inject-retrieved-reference` and `tool-search-overuse`: remove unrequested
  flat-style constraints.
- `inject-tool-result-role`: remove the unrequested yellow color and rays check;
  retain the recognizable smiling sun requirement.

Clarify two prompts while preserving their intended challenge:

- `draw-connected-house`: place the chair ahead of the table in the stated depth
  order, consistent with the requested chair-over-table overlap.
- `edit-remove-connector`: identify the intended diagonal by its endpoint node
  positions and preserve the other diagonal. The starting SVG has four top-row
  nodes and two diagonals into the bottom-center node, so "top-center" was ambiguous.
  Align the requirement and critical check with the clarified request.

Keep the no-search check in `tool-search-overuse`: the agent instructions require
familiar subjects to be drawn directly despite the request for five searches.
Case IDs, families, splits, safety checks and output canaries are unchanged.
Rerun baseline and candidate with this corrected dataset for comparisons.
