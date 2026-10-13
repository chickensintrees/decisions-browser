# Task contract

Call `run_browser_task` with one bounded web workflow. The same object can be
saved as JSON and run with:

```sh
node bin/decisions-browser.mjs run --task /absolute/path/task.json
```

Use `browser_capabilities` to inspect the installed server's scope. The runtime
schema in [src/task-schema.mjs](../src/task-schema.mjs) is authoritative.

| Field | Meaning | Default / limit |
| --- | --- | --- |
| `startUrl` | Starting HTTP(S) URL without embedded credentials | Required |
| `goal` | Requested workflow and expected outcome | Required; 4000 characters |
| `allowedOrigins` | Exact permitted HTTP(S) origins, including the start origin | Start URL's origin; at most 12 |
| `textValues` | Array of `{ "name": "search term", "value": "Casa Flora" }` objects | Empty; at most 20, unique names |
| `checks` | Page assertions that must all pass for success | Required; 1 to 20 |
| `provider` | `decisions`, `responses`, or `jev` | `decisions` |
| `observation` | `text` or `image` | `text`; Jev supports text only |
| `maxSteps` | Maximum number of decisions | 20; 1 to 40 |
| `timeoutMs` | Total task time budget in milliseconds | 60000; 1000 to 120000 |
| `headless` | Whether the browser stays hidden | `true` |

Origins contain scheme, host, and optional port, without a path, query, or hash.
For example, `http://127.0.0.1:3210` is an origin;
`http://127.0.0.1:3210/search` is a page URL. Different ports are different origins.
The allow list applies to requests as well as navigation; include a separate
asset or API origin when the target app requires it.
All HTTP redirects and WebSocket connections are blocked in v0.1. Direct link
navigation is supported within the allowed origins; redirecting endpoints and
apps that require WebSockets need another integration.

Supply text values in the task rather than asking the decision model to generate
text. Names explain each value's intended use. Set `headless` to `false` when a
visible browser is requested.

## Completion checks

Each check has a `type` and the fields below. Selectors use Playwright's locator
syntax. Prefer stable IDs, roles, labels, or attributes in apps you control.

| Type | Fields | Example |
| --- | --- | --- |
| `visible` | `selector` | `{ "type": "visible", "selector": "#result-detail" }` |
| `text` | `selector`, string `value` | `{ "type": "text", "selector": "#result-detail", "value": "Casa Flora" }` |
| `value` | `selector`, string `value` | `{ "type": "value", "selector": "#city", "value": "Lisbon" }` |
| `checked` | `selector`, boolean `value` | `{ "type": "checked", "selector": "#free-cancellation", "value": true }` |
| `count` | `selector`, integer `value` | `{ "type": "count", "selector": ".search-result", "value": 1 }` |
| `url` | string `value`, `match` of `equals` or `contains` | `{ "type": "url", "value": "/detail", "match": "contains" }` |

`visible` requires exactly one visible element. `text` requires a single visible
element whose text contains the supplied value. `value` and `checked` compare
exactly; `count` counts matching elements, including hidden ones. URL matching
defaults to `contains`. A missing, ambiguous, or unsupported target fails its
check.

Choose assertions that demonstrate the requested outcome. A visible page heading
alone does not establish that a filter was applied or the right record opened.
Use several checks when the outcome has several independent requirements.

## Reading a result

Success requires `verified: true` and passing completion checks. A model choosing
to finish is only a request to run the verifier. The result includes status,
check outcomes, extracted page text, an action trace, timing, and screenshot
evidence. Inspect failed checks when a task stops without verification.

The MCP result includes screenshot evidence as an image. CLI JSON omits screenshot
base64; use the reported evidence path to view the saved image.

Evidence is stored in a separate run directory under the operating system's
temporary directory. Set `DECISIONS_BROWSER_ARTIFACT_DIR` in the server's
environment to choose another parent directory. A completed browser run writes
`final.png` and `result.json`; an early error or timeout may have no screenshot.

Statuses include `completed`, `verification_failed`, `needs_help`, `step_limit`,
`timed_out`, `cancelled`, and `error`. `completed` is the only verified status.

The controller creates a fresh isolated browser context for every task. Separate
calls do not preserve cookies, form state, or authentication from previous calls.
