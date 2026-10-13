# Original benchmark: October 13, 2026

This experiment tested whether a finite-choice decision endpoint could shorten a
small browser action loop. The fixture asks the controller to choose Lisbon,
Design, and Free cancellation, search, then open Casa Flora. A separate verifier
checks the filters, the search state, and the opened hotel's attributes.

## Protocol

- One synthetic local fixture served over HTTP, with a 100 ms search delay.
- `gpt-6-luna` for both Decisions and Responses.
- Five fresh browser contexts per provider per observation mode.
- Provider order alternated between rounds; no retries.
- Maximum 20 actions per attempt; 90 second per-run limit.
- Viewport of 1120 x 1000 pixels.
- Responses used `reasoning.effort: "none"` and strict JSON output constrained to
  the offered action IDs. Decisions used a choice question with those IDs.
- Every attempt made six API calls: five UI actions and a completion decision.

Text trials supplied rendered DOM text, current form values, and action
descriptions. Image trials supplied a full-page screenshot at each step and
DOM-derived action descriptions, without separate body text or form state.
Image trials therefore measure screenshot input with DOM assistance.

The task timer includes initial local page navigation, observation, API calls,
UI execution, waiting for the fixture's search, and final verification. Image
trials also include per-step screenshot capture. Both timers exclude shared
browser startup, context creation, final evidence screenshots, and cleanup.

## Results

| Observation | Provider | Passed | Median task time | Median API call |
| --- | --- | ---: | ---: | ---: |
| Text | Decisions | 5 / 5 | 1.390 s | 151.5 ms |
| Text | Responses | 5 / 5 | 8.684 s | 1277.6 ms |
| Screenshot + DOM actions | Decisions | 5 / 5 | 1.919 s | 211.1 ms |
| Screenshot + DOM actions | Responses | 5 / 5 | 7.395 s | 1052.7 ms |

The median task-time ratios were 6.25x for text and 3.85x for image input. All
attempts passed, so these medians also equal the medians of successful attempts.
Raw traces and verification results are in the
[text report](../benchmarks/prototype/text/report.json) and
[image report](../benchmarks/prototype/image/report.json).
[comparison.json](../benchmarks/prototype/comparison.json) records the unrounded summary.

## Reproduce

Install dependencies and a browser using the [README](../README.md). The prototype
benchmark script remains available separately from the MCP task controller:

```sh
npm test
node benchmark.mjs --smoke
node benchmark.mjs --mode text --providers decisions,responses --runs 5 --label text-rerun --key-file /absolute/path/openai-api-key.txt
node benchmark.mjs --mode image --providers decisions,responses --runs 5 --label image-rerun --key-file /absolute/path/openai-api-key.txt
```

The smoke run uses deterministic actions and makes no API calls. Live commands
use the supplied credential and make billable requests. `OPENAI_API_KEY` can
replace `--key-file`. The provider instructions have changed during development
of the MCP controller, so a rerun with the current source is a new experiment;
it is not an exact replay of the archived prototype execution.

Reports are written to `results/<label>/report.json`; the process returns a
nonzero exit code if any attempt fails. Compare pass rates along with latency.

## Limits on interpretation

Twenty successful trials on one simple fixture cannot establish general
reliability or a speedup on real apps. The task had a small number of ordinary
HTML controls, explicit labels, a known goal, and local navigation. Network
delays, authentication, complex widgets, and ambiguous page states were absent.

The experiment did not modify or benchmark ChatGPT's built-in Computer Use. It
did not test native desktop control or Jev's live endpoint. The v0.1 MCP
controller extends this experiment; its release tests are separate evidence.

The source gained image support after the text trials. The delivery hashes in
`comparison.json` identify the final experimental files, not an execution
snapshot captured for the earlier text trials.
