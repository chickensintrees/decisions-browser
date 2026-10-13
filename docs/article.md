# Faster browser workflows with Decisions and MCP

Bill Moore · October 13, 2026

I built Decisions Browser to move a small browser workflow into one local tool
call. Its release benchmark measured a 3.41 to 4.71x speedup with OpenAI Decisions
over Responses, based on median wall times for verified tasks. That result covers two
local demo apps and 40 attempts. The code is now available in the
[v0.1.0 release](https://github.com/chickensintrees/decisions-browser/releases/tag/v0.1.0).

The project began with a familiar frustration: computer use felt painfully slow.
Watching an agent work through a search, a few filters, and a detail page raised
a question. Could a fast decision endpoint handle those routine steps while the
main agent supplied the goal?

That suggested a division of work. The caller describes a bounded task and what
success should look like. A local controller handles the repeated observation,
decision, and browser action. The caller receives the result, failed checks if
any, and a screenshot. Several actions happen inside one MCP call, without the
caller coordinating every individual click.

OpenAI's Decisions API fits the decision step because it can choose from a fixed
set of supplied options using text, images, or both. As of October 13, it is in
public beta and supports `gpt-6-luna`.
[Official API documentation](https://developers.openai.com/api/docs/guides/decisions)
describes its typed answers and request format.

In Decisions Browser, Playwright discovers ordinary HTML controls and turns
them into choices: set this dropdown, select this radio, enable this checkbox,
click this link, or fill this field with a supplied value. The model chooses an
action ID. The controller validates that choice, checks that the control still
matches, and executes it. Text comes from the caller's `textValues`; the decision
model selects among those known values. The
[released controller](https://github.com/chickensintrees/decisions-browser/blob/v0.1.0/src/controller.mjs)
keeps this loop inside `run_browser_task`.

The caller also supplies completion assertions. For the catalog demo, finding
Casa Flora is insufficient: its city and style must match, Free cancellation
must be selected, and the applied query must be correct. When the model chooses
`DONE`, code evaluates those assertions. Success requires every check to pass.
An [earlier development run](https://github.com/chickensintrees/decisions-browser/blob/v0.1.0/benchmarks/smoke-v0.1.0/report.json)
reached the correct hotel while missing the checkbox; verification exposed the
incomplete task. That is why the finish decision and the success test are
separate operations.

After building the MCP integration, we compared Decisions and Responses on the
catalog and a support-ticket search. Each provider ran five attempts for each
task in each of two observation modes. Both used `gpt-6-luna`; Responses used
strict JSON output and reasoning effort `none`. Provider order alternated, and
there were no retries.

| Task and input | Decisions verified | Responses verified | Decisions median | Responses median | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Catalog, text | 5 / 5 | 4 / 5 | 2.007 s | 9.459 s | 4.71x |
| Queue, text | 5 / 5 | 5 / 5 | 1.682 s | 6.940 s | 4.13x |
| Catalog, image | 5 / 5 | 5 / 5 | 2.699 s | 9.969 s | 3.69x |
| Queue, image | 5 / 5 | 5 / 5 | 2.522 s | 8.610 s | 3.41x |

These medians use verified attempts. Decisions passed 20 of 20; Responses passed
19 of 20. One Responses attempt returned invalid decision JSON. The controller
rejected that response before executing its proposed input, and the failed
attempt remains in the
[tagged benchmark report](https://github.com/chickensintrees/decisions-browser/blob/v0.1.0/benchmarks/v0.1.0/report.json).

The timer includes browser startup, page loads, model calls, actions, independent
checks, evidence capture, cleanup, and MCP transport. Initial connection to the
persistent MCP server is excluded. Image mode supplies a viewport screenshot
plus DOM-derived action descriptions. Both providers used the same controller
behind one MCP call, so the measured ratios compare provider choice within this
design; they do not quantify a separate gain from batching the loop.

**OpenAI should make this a supported browser workflow in Codex and ChatGPT.**
Its [Decisions documentation](https://developers.openai.com/api/docs/guides/decisions)
advertises typed answers roughly ten times faster than Responses. Its
[voice-to-Decisions example](https://developers.openai.com/api/docs/guides/decisions-voice)
already demonstrates selecting browser actions and routing complex requests to
a reasoning model. OpenAI has published both the primitive and the pattern.
The advertised endpoint speed is separate from our measured workflow speedup.

The [Codex changelog](https://learn.chatgpt.com/docs/changelog) already lists an
opt-in Decisions comparison for Guardian, Codex's approval reviewer. That is
real integration. As of October 13, I found no documented way in the
[Computer Use guide](https://learn.chatgpt.com/docs/computer-use) to enable
Decisions for the browser action loop. Internal routing remains unknown; the
gap I can identify is the lack of a documented, supported path for the workflow
we tested.

For this experiment, getting that workflow into Codex meant building an MCP
server, wiring Playwright, configuring an API credential, and installing a
delegation skill. That is a lot of plumbing for a company that already provides
the underlying capability. OpenAI should offer this workflow directly: let the
main agent plan and handle exceptions, route suitable finite action choices
through fast decisions, and return independently verified evidence. Keep the
permission and origin boundaries, and publish task-level latency and success
rates so users can judge the tradeoff. Our two-app benchmark motivates that
product work; broader testing is still needed to establish its benefit in
OpenAI's built-in tools.

Release preparation included 38 automated checks, a fresh-clone installation,
and a packaged-artifact MCP check. CI passed on Windows and Linux with Node 20
and 24. The
[CI run](https://github.com/chickensintrees/decisions-browser/actions/runs/38447173387)
and [test source](https://github.com/chickensintrees/decisions-browser/blob/v0.1.0/test/controller.test.mjs)
are public.

Review also found a concrete boundary bug: checking an initial request's origin
did not prevent automatic HTTP redirect following. The release fetches without
following redirects and blocks redirects, including those within the same
origin. Regression tests confirm that redirect destinations receive no request.
A WebSocket test first proves its fixture can detect a real handshake, then
checks that the controller blocks it. A zero count needs a working detector.

The useful scope is local or staging apps with ordinary controls and explicit
outcomes. Each task starts with an isolated browser context. Existing signed-in
sessions, native desktop apps, iframes, shadow roots, custom ARIA widgets,
password entry, uploads, redirects, and WebSockets are outside v0.1's scope.
Observations go to the chosen API provider, so test data should suit that use.

Two local apps cannot establish general browser reliability. We did not
benchmark ChatGPT's built-in Computer Use. A text-only Jev adapter is included,
but its live endpoint was not tested.

To try the released version, install Node 20.18 or newer and run:

```sh
git clone --branch v0.1.0 https://github.com/chickensintrees/decisions-browser.git
cd decisions-browser
npm ci
npx playwright install chromium
npm run demo
```

In another terminal, set `OPENAI_API_KEY_FILE` to an external credential file and
run `node bin/decisions-browser.mjs run --task examples/tasks/catalog.json`.
The [setup guide](https://github.com/chickensintrees/decisions-browser/blob/v0.1.0/README.md)
also covers registering the local MCP server with Codex. Start with a small
workflow whose outcome you can assert, then inspect its verification and evidence.
