---
name: decisions-browser
description: Run bounded local or staging web-app searches, filters, forms, and verification through the Decisions Browser MCP tool when that tool is connected. Uses an isolated browser; native desktop apps and existing signed-in browser sessions are outside its scope.
---

Use `browser_capabilities` to confirm the connected version's supported inputs.
Delegate a complete small workflow to `run_browser_task` so observations and
decisions stay inside one call.

Prepare a task with a trusted HTTP(S) `startUrl`, a concrete `goal`, and explicit
completion `checks`. `allowedOrigins` defaults to the start origin; add only
origins required for the user's workflow. Supply known form or search text as
`textValues: [{ name, value }]`. The controller selects from those values and
available page actions.

Use `provider: "decisions"` and `observation: "text"` for ordinary DOM workflows.
Image observations add a screenshot to DOM-derived action descriptions; they do
not add native desktop or screenshot-only control. Keep the default headless
browser unless the user requests a visible window.

Define checks that prove the requested outcome using stable selectors or URL
matches. Combine relevant form values, result text, visibility, checked state,
counts, or URL checks. For the exact schema, read
[the task contract](https://github.com/chickensintrees/decisions-browser/blob/main/docs/tasks.md).

Each task starts with a fresh browser context. It cannot use a user's existing
Chrome login or continue an earlier task's session. Supported ordinary HTML
controls include text entry, native selects, checkboxes, radios, buttons, and
links. Iframes, shadow roots, custom ARIA widgets, and uploads need another
integration. HTTP redirects and WebSockets are blocked in v0.1; direct links
within the allowed origins remain supported. Password entry is unavailable.

Call the tool within the user's authorized goal; it can submit forms and change
the target app. Read `verified`, the check results, and screenshot evidence before
reporting success. When verification fails, use the trace and failed checks to
make a focused correction. Do not turn a failed verification into a success claim
or keep repeating a task without a changed hypothesis.
