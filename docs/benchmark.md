# v0.1.0 MCP benchmark: October 13, 2026

The release benchmark ran the real stdio MCP tool on two local demo apps: a stay
catalog and a support queue. Decisions verified all 20 attempts. Responses
verified 19 of 20. Among verified tasks, Decisions' median wall time was 3.4 to
4.7 times faster in these four task/input conditions.

## Protocol

- Two local apps, `catalog` and `queue`, using the included task JSON files.
- Text and image observations, with five attempts per provider/task/input condition.
- Both providers used `gpt-6-luna`; provider order alternated between rounds.
- Decisions selected a supplied choice. Responses used strict JSON constrained to
  the same choices and `reasoning.effort: "none"`.
- Every attempt ran one `run_browser_task` call with a fresh isolated browser.
- No retries; all 40 attempts, including the failure, remain in the report.

Text observations used rendered DOM text, form state, and action descriptions.
Image observations supplied a viewport screenshot and DOM-derived action
descriptions. Image mode is DOM-assisted, rather than screenshot-only control.

The wall timer starts with the MCP client's tool call and ends with its returned
result. It includes browser startup, page loads, observations, model calls, UI
actions, independent checks, evidence capture, browser cleanup, and JSON-RPC
transport. The persistent MCP server's initial connection setup is outside each
task's timer.

The controller evaluates caller-supplied DOM and URL checks after the model
chooses `DONE`. Fixture request logs provide additional evidence of searches and
navigation. Source SHA-256 hashes are recorded in the report.
These hashes identify LF source bytes matching the Git blobs; text files preserve
LF line endings through the repository's `.gitattributes` configuration.

## Results

| Task / input | Decisions verified | Responses verified | Decisions median | Responses median | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Catalog / text | 5 / 5 | 4 / 5 | 2.007 s | 9.459 s | 4.71x |
| Queue / text | 5 / 5 | 5 / 5 | 1.682 s | 6.940 s | 4.13x |
| Catalog / image | 5 / 5 | 5 / 5 | 2.699 s | 9.969 s | 3.69x |
| Queue / image | 5 / 5 | 5 / 5 | 2.522 s | 8.610 s | 3.41x |

Medians and ratios in this table use **verified attempts**. The report also
includes medians across all attempts, raw action traces, token usage, check
outcomes, screenshots, and fixture request logs. See
[the complete release report](../benchmarks/v0.1.0/report.json).

The failed Responses attempt was catalog/text round 4: the provider returned
invalid decision JSON. The controller rejected that response before executing
its proposed input and returned an unverified error. This attempt was retained;
there was no retry. It contributes to the 4 / 5 pass count, but has no verified
task time.

The benchmark process returned exit code 1 because one comparative baseline
attempt failed. That exit code does not alter the measured default Decisions
provider's 20 / 20 verification count.

## Reproduce

Install dependencies and Chromium using the [README](../README.md), then run:

```sh
npm test
npm run check
node scripts/live-mcp-benchmark.mjs --runs 5 --modes text,image --tasks catalog,queue --label local-rerun --key-file /absolute/path/openai-api-key.txt
```

The live script starts its own local fixtures and MCP server. It makes billable
API requests and writes `benchmarks/local-rerun/report.json`, traces, and
screenshots. Choose a new label to preserve the archived release data.
`OPENAI_API_KEY` or `OPENAI_API_KEY_FILE` can replace `--key-file`. Any unverified
attempt causes a nonzero process exit; compare success counts along with latency.

## Limits

Two local apps and five attempts per condition cannot establish general browser
reliability or a universal speedup. Both tasks have ordinary HTML controls,
explicit labels, known text values, local network calls, and declared checks.
They omit authentication, complex widgets, HTTP redirects, and WebSockets.

This measures a custom MCP browser controller, not ChatGPT's built-in Computer
Use. It does not measure native desktop automation or Jev's live endpoint. Model
and network behavior can change between runs; the archived report is evidence
for this dated experiment.

The earlier one-task prototype used a different timer and predates the released
MCP controller. Its archived results and provenance are described separately in
[the prototype methodology](prototype-benchmark.md).
