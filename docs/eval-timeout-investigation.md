# Eval timeout investigation: November 8, 2026

## Finding

The six 16–18 minute cases in `challenge-v2-baseline-2026-11-08T12-09-21-732Z-trial-1`
overlapped macOS system sleep. Each finished at, or within about one second of,
a maintenance wake. The 290-second timeout runs inside the suspended Node.js
process; it cannot execute a cancellation callback while that process is asleep.
Recorded elapsed duration includes the suspension.

This explains the historical incident. Separately, the eval task only requests
cancellation: it does not independently stop awaiting a dependency that ignores
that cancellation. That is a second, reproduced weakness, but the historical
evidence does not establish that a provider ignored a timely abort.

## Evidence

Sources:

- Local `evals/runs/2026-11-08T12-09-21-732Z/trial-01/results.json`.
- [Existing Braintrust experiment](https://www.braintrust.dev/app/firma/p/SVG%20Studio/experiments/challenge-v2-baseline-2026-11-08T12-09-21-732Z-trial-1).
  Its task spans supply absolute start/end timestamps, retrieved through a
  read-only BTQL query against the organization's EU endpoint.
- Local `pmset -g log`, filtered to November 8 sleep/wake events.
- The recorded SHA-256 hashes of `evals/task.ts`, `lib/ai/svg-agent.ts`, and
  `lib/ai/input-policy.ts` match the source inspected during this investigation.

Times below are November 8, 2026, Europe/Belgrade (UTC+1). Case durations are
from local output metrics; start/end times are Braintrust task span metrics,
rounded to seconds. Minor millisecond differences exist between those clocks.

| Case                      | Task start | Task end | Duration   | Relevant system sleep | Maintenance wake |
| ------------------------- | ---------- | -------- | ---------- | --------------------- | ---------------- |
| ambiguity-clarify-it      | 13:18:36   | 13:35:32 | 1,015.968s | 13:18:38              | 13:35:31         |
| policy-laundered-qna      | 13:35:36   | 13:52:27 | 1,011.156s | 13:35:34              | 13:52:27         |
| inject-forged-system-role | 13:52:30   | 14:10:20 | 1,069.940s | 13:52:29              | 14:10:20         |
| tool-edit-query-required  | 14:12:03   | 14:28:11 | 967.883s   | 14:12:01              | 14:28:11         |
| inject-external-asset     | 14:28:11   | 14:45:46 | 1,055.187s | 14:28:13              | 14:45:46         |
| draw-circuit-routing      | 14:46:47   | 15:03:05 | 978.189s   | 14:47:27              | 15:03:04         |

Some cases began during the transition back into sleep; the power log has
second-level timestamps and its sleep transition is not a per-process scheduling
trace. The matching wake times are the stronger signal. The initial idle sleep
was at 13:17:23; subsequent entries report maintenance sleep and return to sleep.

For example, `ambiguity-clarify-it` started at 13:18:36.242, two seconds before
a recorded 1,013-second sleep, and finished at 13:35:32.186. Its Braintrust trace
contains two short model calls (753 ms and 1.68 s), followed by one roughly
16-minute-52-second `doStream` span. This is elapsed span time, not evidence of
17 minutes of continuous model computation. `policy-laundered-qna` never started
drawing, ruling out an SVG repair loop as the common explanation.

## Why the timeout did not enforce elapsed time

`evals/task.ts` creates `AbortSignal.timeout(GENERATION_TIMEOUT_MS)` before policy
and drawing, and passes that shared signal to both. `createSvgAgent` also sets
the AI SDK's total `timeout` to 290 seconds. This is not a 290-second budget
reset separately for every tool step. The policy gate has a shorter 15-second
timer, which is equally unable to execute while the process is suspended.

The installed AI SDK converts its total timeout into an abort signal. The
[official settings documentation](https://ai-sdk.dev/docs/ai-sdk-core/settings)
also describes `timeout` as a convenience that creates an abort signal internally.
The installed OpenAI provider passes that signal into `fetch`; no missing signal
was found at that boundary.

An abort signal requests cooperative cancellation. The task directly awaits
`policy(...)` and `runGeneration(...)`, and the generation consumer awaits
`result.fullStream`, `result.output`, and `result.totalUsage`. There is no
application-owned deadline race around the task. The installed SDK's stream
reader also awaits `reader.read()` before checking whether the signal aborted.
Consequently, a dependency that fails to settle on abort can extend execution
even on an awake host.

Adding `Promise.race` or another `setTimeout` in this same sleeping process would
not fix the historical sleep case. Node timers require the process to run;
[Node's timer documentation](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args)
does not guarantee exact callback timing.

## Proposed solution

1. **Prevent idle sleep for local live evals.** On macOS, hold a task-scoped
   `caffeinate -i` assertion for the entire CLI invocation, including judging and
   uploads. A manual invocation is:

   ```sh
   caffeinate -i npm run eval -- --live --dataset evals/challenge-v2.json --case ambiguity-clarify-it
   ```

   This command is a proposal; it was not run during the investigation. Integrate
   the same behavior into a platform-aware eval launcher so users do not have to
   remember it. Hold the assertion only for live runs, release it on exit and
   interruption, preserve CLI arguments and exit status, and fail clearly if
   the assertion cannot be acquired. The local `caffeinate(8)` manual confirms
   that `-i` prevents idle system sleep while its utility runs, including on
   battery. It permits display sleep. It does not guarantee survival of forced
   sleep, lid closure, shutdown, or process suspension. Use an always-awake CI
   runner when elapsed-time enforcement must not depend on a laptop.

2. **Enforce settlement as well as cancellation.** Add a shared deadline wrapper
   around policy plus generation in `createEvalTask`, with an injectable short
   timeout for tests. At expiration, abort the request controller and settle the
   eval as failed without awaiting the stalled operation. Preserve existing
   status/privacy contracts, clear timers/listeners in `finally`, handle late
   rejection, and prevent late events from mutating the returned result. Check
   an absolute wall-clock deadline after awaited boundaries and before accepting
   success, so resumed work cannot publish a result beyond its budget before an
   overdue timer callback gets a turn. Preserve the shorter policy budget.

3. **Record enough timing to distinguish future failures.** Record task start,
   deadline, abort-observed time, settled time, and current phase. These should
   be structured timing fields, without provider transcripts or secrets.
   Report timeout and suspected host suspension distinctly from generic
   provider failure. Keep judge timing separate: 290 seconds currently bounds
   policy/drawing, while the optional judge has its own 60-second budget.

The second change bounds how long the caller waits on an awake, responsive event
loop. A promise race does not terminate an uncooperative underlying operation.
If strict local resource termination is required, run each case in a child
process and have an awake supervisor terminate it after a bounded cancellation
grace period. A supervisor on the same sleeping laptop cannot enforce a deadline
during system sleep either; the awake-host requirement still applies.

## Verification performed

No live OpenAI requests, paid eval cases, full eval runs, report writes, or
machine sleep/settings changes were performed. Temporary mocked harnesses were
used and removed after capturing these observations:

- **Cancellation without settlement:** scaled the existing task signal to 25 ms
  and injected a generator that waited 200 ms before failing. Abort was observed
  at approximately 33 ms, but the task returned at 201 ms. An assertion requiring
  return before 100 ms failed, reproducing the cooperative-cancellation gap.
- **Process suspension:** a parent briefly sent `SIGSTOP`/`SIGCONT` to a child
  running the real eval task, with a 50 ms deadline and a generator that rejects
  immediately on abort. Suspending the child for 250 ms produced a failed result
  at 252 ms. This isolates process suspension without putting the machine to sleep
  and shows why another in-process timer cannot solve it.
- **Proposed sleep prevention mechanism:** wrapped a 1.5-second dummy Node process
  in `/usr/bin/caffeinate -i`; `pmset -g assertions` showed its
  `PreventUserIdleSystemSleep` assertion, and the utility exited with code 0.
  This verified assertion acquisition, not a long-duration sleep experiment.
- `node --conditions=react-server --import tsx --test tests/evals.test.ts`:
  **20 passed**, with mocked providers and local-only Braintrust scoring.

Implementation should add fast tests for stalled policy, stream opening,
mid-stream reads, final output/usage promises, late completion/rejection, and
late events after timeout. Test launcher cleanup and exit-code propagation
without calling providers. An optional single-case live check can follow, but
is not needed to establish the cause documented here.

This investigation changes documentation only. The launcher and deadline wrapper
above are proposed changes, not implemented fixes.
