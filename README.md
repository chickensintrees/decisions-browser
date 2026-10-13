# Decisions Browser

A local MCP tool that runs several browser actions inside one tool call. A host
agent supplies a goal, allowed web origins, text to enter, and completion checks.
The controller observes the page, offers a finite set of available actions to
OpenAI's Decisions API, executes the selected action with Playwright, and verifies
the result against those checks.

Use it for repeatable searches, filters, forms, and checks in local or staging web
apps. Each task gets a fresh browser context; the default is headless Chromium.

Read [Faster browser workflows with Decisions and MCP](docs/article.md) for the
build, release benchmark, and verification lessons behind v0.1.0.

## Install from source

Requires Node.js 20.18 or newer and an OpenAI API key with Decisions API access.
[The Decisions API](https://developers.openai.com/api/docs/guides/decisions)
is in public beta as of October 13, 2026; its supported model is `gpt-6-luna`.

```sh
git clone https://github.com/chickensintrees/decisions-browser.git
cd decisions-browser
npm ci
npx playwright install chromium
node bin/decisions-browser.mjs --help
```

Set `OPENAI_API_KEY` in the server's environment, or set `OPENAI_API_KEY_FILE` to
an absolute path outside the repository. A key file may contain one API key or an
`OPENAI_API_KEY=...` assignment. Keep credentials out of task JSON and source
control.

You can use an installed Chromium-based browser instead of downloading Chromium
by setting `BENCH_BROWSER_PATH` to its executable. This launches a separate browser;
it does not attach to a personal browser profile.

## Try a local task

Start the included demo app in one terminal:

```sh
npm run demo
```

In a second terminal, configure the credential and run a task. For bash:

```sh
export OPENAI_API_KEY_FILE="/absolute/path/openai-api-key.txt"
node bin/decisions-browser.mjs run --task examples/tasks/catalog.json
node bin/decisions-browser.mjs run --task examples/tasks/queue.json
```

For PowerShell:

```powershell
$env:OPENAI_API_KEY_FILE = 'C:/keys/openai-api-key.txt'
node bin/decisions-browser.mjs run --task examples/tasks/catalog.json
node bin/decisions-browser.mjs run --task examples/tasks/queue.json
```

The demos run at `http://127.0.0.1:4173`. The
[catalog task](examples/tasks/catalog.json) exercises text entry, a dropdown,
radio selection, a checkbox, searching, and navigation. The
[queue task](examples/tasks/queue.json) searches for a ticket and verifies its
details. These calls make API requests.

Each command prints a result with `verified`, per-check outcomes, timing, and
saved evidence paths. It returns exit code 0 only for a verified task. Stop the
demo server with Ctrl+C when finished.

## Connect to Codex

Register the local stdio server with an absolute path. For a key file, pass its
path rather than the credential itself:

```sh
codex mcp add decisions-browser --env OPENAI_API_KEY_FILE=/absolute/path/openai-api-key.txt -- node /absolute/path/decisions-browser/bin/decisions-browser.mjs
codex mcp list
```

On Windows, use quoted paths such as
`"C:/tools/decisions-browser/bin/decisions-browser.mjs"`.

Alternatively, add this table to your Codex `config.toml` and make the credential
environment variables available to the process that launches Codex:

```toml
[mcp_servers.decisions-browser]
command = "node"
args = ["/absolute/path/decisions-browser/bin/decisions-browser.mjs"]
env_vars = ["OPENAI_API_KEY", "OPENAI_API_KEY_FILE", "BENCH_BROWSER_PATH"]
tool_timeout_sec = 130
```

Use only one registration method. Set the host's `tool_timeout_sec` above the
task's `timeoutMs` (converted to seconds), leaving time to return evidence. The
130 second example exceeds the maximum task deadline of 120 seconds. CLI
registration does not set this timeout; add it to the server's configuration
table after registering if you use that method.
See [official MCP setup documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
for host configuration. Local Codex configuration applies to supported local
clients; ChatGPT web does not read it.

The repository also includes an optional
[delegation skill](skills/decisions-browser/SKILL.md). To make it discoverable in
Codex, copy the `skills/decisions-browser` folder to
`~/.codex/skills/decisions-browser`. Configure the MCP server using the steps above;
the skill guides task construction and interpretation of verification results.

## How the loop works

1. Open `startUrl` in an isolated browser context.
2. Read visible DOM text and supported controls; optionally include a screenshot.
3. Send the goal, recent actions, and available choices to the selected provider.
4. Validate the returned choice, then perform that offered action.
5. Verify explicit page checks before reporting success.

The model chooses among actions discovered from the page. Text entry uses values
supplied by the caller, so the decision model does not invent form data.
Completion checks run in code independently of the model's decision to finish.

The MCP server exposes `browser_capabilities` to describe the installed tool and
`run_browser_task` to run a task. See the [task contract](docs/tasks.md) for inputs
and completion checks.

After connecting, try: "Use Decisions Browser to run the catalog demo task in
this repository and show whether each completion check passed."

## Scope of v0.1

Supported controls are buttons, links, text inputs and textareas, native selects,
checkboxes, radios, Enter submission, scrolling, and waiting. Tasks have explicit
origins, step limits, and time limits.

The controller runs a DOM-assisted browser workflow. Native desktop apps,
existing signed-in browser sessions, iframes, shadow roots, custom ARIA widgets,
password entry, and file uploads are outside this release's scope. HTTP redirects
and WebSocket connections are blocked. Direct links within the allowed origins
work; redirecting endpoints require another integration. Screenshot mode still
uses DOM-derived action choices.

Page observations are sent to the selected API provider. Use a test app and test
data appropriate for that provider. Actions can submit forms or change the app;
choose the task and allowed origins accordingly. Origin restrictions apply to
network requests as well as navigation, so an app may need its asset and API
origins listed explicitly.

Decisions is the default provider. Responses is available for comparison. A Jev
adapter accepts text observations and requires `TYPESAFE_API_KEY`; its live
endpoint has not been tested for this release. OpenAI providers use
`OPENAI_API_KEY` or `OPENAI_API_KEY_FILE`.

## What we measured

The v0.1.0 release benchmark ran the actual MCP tool on two local demo apps, with
five trials per provider/task/input condition. Both providers used `gpt-6-luna`.
Decisions verified **20 / 20** attempts; Responses verified **19 / 20**.

| Task / input | Decisions verified | Responses verified | Decisions median | Responses median | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Catalog / text | 5 / 5 | 4 / 5 | 2.007 s | 9.459 s | 4.71x |
| Queue / text | 5 / 5 | 5 / 5 | 1.682 s | 6.940 s | 4.13x |
| Catalog / image | 5 / 5 | 5 / 5 | 2.699 s | 9.969 s | 3.69x |
| Queue / image | 5 / 5 | 5 / 5 | 2.522 s | 8.610 s | 3.41x |

Medians and ratios use verified attempts. The timer covers the full MCP call,
including browser startup, page loads, model calls, actions, checks, screenshot
evidence, and cleanup. Image observations include DOM action descriptions.
The failed Responses attempt returned invalid JSON and was rejected before
executing its proposed input; it remains in the data and was not retried.

These measurements cover two local tasks. They do not measure ChatGPT's built-in
Computer Use, establish general browser reliability, or guarantee a speedup for
other apps. Jev was not tested live.

See [release methodology and reproduction](docs/benchmark.md) and the
[complete v0.1.0 report](benchmarks/v0.1.0/report.json). The earlier one-task
experiment is archived separately in [prototype methodology](docs/prototype-benchmark.md)
and [prototype data](benchmarks/prototype/comparison.json); its timer differs.

## Development checks

```sh
npm test
npm run check
```

The tests use local fixtures and mocked provider decisions. They exercise the
browser path, independent verification, failure cases, and MCP transport without
requiring API credentials. Live API measurements remain separate from those tests.

## License

[MIT](LICENSE), copyright 2026 Bill Moore.
