# Recorded comparison on October 15 2026

[Watch or download the complete side by side video](https://github.com/chickensintrees/decisions-browser/releases/download/v0.1.0/decisions-vs-computer-use.mp4).
The [machine-readable comparison](comparison.json) retains the task, all eleven
completion checks, selected durations, recording attempts, and source hashes.

Both lanes start on the same untouched local catalog page. Each must enter
`flora`, select Lisbon and Design, enable Free cancellation, search, and open
Casa Flora with the requested filters applied. A passive observer checks the
same eleven DOM and URL assertions in both browser contexts. Its polling
interval is 40 milliseconds. The measured clock begins when the page is ready
and ends at the first observation that every assertion passes.

| Lane | Measured task time | Checks passed |
| --- | ---: | ---: |
| Decisions Browser, DOM observations and gpt-6-luna | 1.6858144 seconds | 11 / 11 |
| Windows Computer Use, host agent through accessibility and screenshots | 160.1664003 seconds | 11 / 11 |

The Windows trial includes input recovery, host reasoning, and tool latency.
Its exact host model identifier was not captured. This is one illustrative
comparison between systems with different models and control paths. It does
not establish a typical speedup over Codex or ChatGPT Computer Use. The
Decisions lane's full MCP call took 3.2778445 seconds; that broader timer is
different from the page interaction clock in this video.

The export plays each task at 1x, synchronizes its start, clamps each clock at
verified completion, and holds the completed lane while the other continues.
It removes setup before the clock and trims footage only after completion.
Viewport capture excludes browser chrome, the OS cursor, and native popups.
There is no task action speedup or removal of recovery within the measured run.

The attempt record includes an untimed Windows setup failure, a verified
Decisions capture whose first frame arrived after timing started, and a
Decisions recorder setup failure before any model calls. Recording setup was
fixed between captures; the app, controller, goal, and checks stayed the same.

The independent [v0.1.0 release benchmark](../v0.1.0/report.json) compares
Decisions and Responses inside the same MCP controller and uses the same
gpt-6-luna model. Its forty trials answer a different question. Its reported
medians cover complete MCP calls, including browser setup and cleanup.

The recorder and compositor live in [scripts/record-demo.mjs](../../scripts/record-demo.mjs)
and [scripts/compose-demo.mjs](../../scripts/compose-demo.mjs). The compositor
requires FFmpeg. Run each script with `--help` for its arguments. Repeating the
Windows lane requires an agent to operate the real browser through Computer
Use; the recorder does not substitute a scripted browser automation baseline.
