# Release checks and integration tests

`checks/` is a test suite that checks, per SilverBullet release, the behaviour the design of this server relies on: every assumption in [docs/facts/](../docs/facts/), [docs/security.md](../docs/security.md) and [docs/architecture.md](../docs/architecture.md) is an assertion here, or a documented skip. SilverBullet is in active development; this is how a release is found to have changed something before the server breaks on it.

## Run

Needs Node.js 24 or newer (it runs the `.ts` files directly) and a SilverBullet instance in multi-space mode with the Runtime API available. With Docker, from the repository root:

```sh
npm install                          # the server's dependencies; playwright for the browser checks is optional
node test/instance.ts up             # starts this working copy's SilverBullet instance and bootstraps it
node test/run.ts                     # all checks, report (starts the instance itself if needed)
npm run test:integration             # the server's integration tests, test/server/*.test.ts (starts the instance itself)
node test/instance.ts down           # remove the instance with its volume (down -v)
```

**One instance per working copy.** `test/instance.ts` takes the Docker Compose project name and the port from the working copy, so working copies on one machine never share an instance: on a branch `claude/task-<id>-…` the project is `sbmcp-test-<id>` and the port `10000+<id>` (ids up to 29999); in another linked worktree both come from a hash of the path (ports 40000 to 59999); a plain clone and CI keep `sbmcp-test` and 3300. `COMPOSE_PROJECT_NAME` and `SB_PORT` in the environment win. `up` records the instance in `test/.state/env`; `down` and `env` read it from there, so they find the instance `up` started even after a branch switch. `up` bootstraps only when that file is not current, `node test/bootstrap.ts` forces it. With `SB_URL` set, `up` and the npm test scripts leave the instance to you. `node test/instance.ts env` prints what applies, to use with `docker compose -p` by hand.

**Never copy `test/.state`** from another working copy: the tokens in it belong to that instance and a bootstrap against another one replaces them. Each working copy writes its own with `up`. When you are done, remove the instance with `node test/instance.ts down` (or `docker compose -p <project> -f test/compose.yaml down -v`); an instance that stays up holds a container, a volume and a port.

Another release: `SB_IMAGE=ghcr.io/silverbulletmd/silverbullet:edge node test/instance.ts up`, then the same run.

Without Docker, against any instance you run yourself (the server binary with `silverbullet setup <folder> --admin admin:<password>`, and `SB_CHROME_PATH` pointing at a Chromium for the Runtime API):

```sh
SB_URL=http://127.0.0.1:3300 SB_ADMIN_PASSWORD=<password> node test/run.ts
```

The bootstrap (`lib/bootstrap.ts`, also `node test/bootstrap.ts`) goes through the admin API: Runtime API on, users `alice`, `bob`, `dora` and `scan` (the server's technical user, a write member of `alpha`, `beta` and `gamma`), spaces `alpha`, `beta`, `gamma` and `delta`, one API token per user, the seed pages of `seed/`, the `CONFIG` pages of every space with the shipped transform block, the Proposals library as `npm run build:library` writes it in `delta` (rewritten on every run), and a plain `index` page where a seed has one (SilverBullet's stock index page calls `config.get`, which the server's scan would report). Tokens land in `.state/env` (git-ignored). A second run keeps what exists. `node test/run.ts index parser` runs only the check files whose name contains one of the words.

The seed pages of `alpha` hold code outside `Library/` on purpose (`Outside`, `Styled`, `Side effect`, `Rendered`), so the server's scan always has findings there and rendering is blocked in `alpha`; `beta` is clean; `gamma` is clean and has the Runtime API for alice (bob is a read member), and is where the server's render tools are tested (`server/04-render.test.ts`: every item of the design's acceptance list, the index wait with a forced `system.reboot()` fallback, the queue under parallel calls, the render check refusing a built transclusion and a page written by another route, and a recording proxy that asserts the source tools never touch `/.runtime/*`). The integration tests (`server/`) write the server's configuration files into a temporary directory from the tokens in `.state/env`, spawn `node src/main.ts` per scenario and talk to it with the MCP SDK's client; they clean up what they create. The render tests need the headless Chrome inside the SilverBullet container, which the compose instance has.

`delta` is not one of the server's spaces: it is where `dora`, a person with the Runtime API, reviews change proposals with the Proposals library (`library/`). The tests in `library/` (`npm run test:library`) install the library as the sources build it now and restart the runtimes first, so it is the one loaded; write their pages through dora's client, whose index learns about a page written through the file API only when it syncs; and assert on the document of that client (the counter, the buttons, the bar above a working copy), clicking the buttons as a person would. Their proposal folder is `P/`. They delete their pages (`T/…`, `P/…`, `Q/…`, `Working copies/…`) before each test. A test that needs a confirmation dialog answered replaces `editor.confirm` in that client.

The browser checks need Chromium for Playwright: `cd test && npx playwright install chromium`. Without it they are skipped, as with `SB_BROWSER=0`. The memory measurement reads the container's cgroup through `docker exec` (container name in `SB_CONTAINER`, set by `up` in `.state/env`, default `sbmcp-test-silverbullet-1`); without Docker it is skipped.

Any Docker with Compose works; give the daemon or VM about 4 GB, since the container runs a Chromium per runtime.

## What is checked

| File | Assumptions |
|---|---|
| `checks/01-access.test.ts` | Tokens work per space; 401/403/404 as documented; read-only members; `/.config` with `spacePrefixes` and `readOnly`; conditional writes with strong ETags; the admin API with an admin token |
| `checks/02-runtime.test.ts` | `markdown.expandMarkdown` evaluates everything; the `_CTX` gap; the write guard and its `fetch` bypass; the runtime is the token's user and needs Write; screenshots, `?selector=`, `?fullPage=` |
| `checks/03-execution.test.ts` | Which fences execute; inert fences and code spans; query clauses as full Lua; `.lua` only through `dofile`; `.html` served inline without CSP; the event stream; how fast the headless runtime sees and indexes a write |
| `checks/04-index.test.ts` | What the index holds of `CONFIG` and `Library/`; the shipped transform block (verbatim as in the security model) and its effect on `space-lua` and `space-style`; survival across reload, reboot, reindex and a fresh runtime; the `return {}` defect; the hazard of an index built without the transform; scripts not reloaded after an incremental index; `CONFIG`'s objects cannot be dropped |
| `checks/05-parser.test.ts` | The write-filter matrix (100 cases, `src/filter/cases.ts`) with the shipped allowlist; the four vendored parser files of `src/filter/vendor/` unchanged at the release's tag; the pinned `@lezer/*` versions (both need the network) |
| `checks/06-cost.test.ts` | The filter's time per 50 KB page |
| `checks/07-browser.test.ts` | A fresh browser client (service worker, IndexedDB) boots with the transform active; an API write is indexed with its script replaced and a reload loads nothing |
| `checks/08-api.test.ts` | The never-allowed names and their reviewed members (`src/filter/allowlist.ts`): every reviewed member exists and behaves as reviewed (`os.date` formats the clock, `schema.*` return plain tables, `markdown.parseMarkdown` does not evaluate, …); every global of the release's Lua environment is classified, so a new API is noticed |
| `checks/09-transclusion.test.ts` | The forms of a transclusion SilverBullet expands (`![[…]]` with heading, position, alias, `/`, `^`, `.md`; the image form; inside HTML blocks and comments), each refused by the write filter for a reader without `r` on the target; the forms it leaves alone; an expression that returns a transclusion is not expanded by the Runtime API but is by the editor, which reads the target; what the render check rests on: the runtime's browser records every read of the file API, a page and its transclusion are read again after leaving and coming back, a same-page navigation does not re-read transclusions, a navigation to a missing page creates nothing |
| `checks/10-redaction.test.ts` | What the redaction of `screenshot-note` rests on: space styles are `<style>` elements in `#custom-styles`; their imports, fonts and backgrounds are fetched as `css`, an image of a page as `img`; an image shown again from the memory cache leaves no timing entry; the server's inventory finds sheets, font faces, backgrounds and images; removing a `@font-face` rule drops the face, a placeholder replaces a cached image, a disabled `#custom-styles` sheet takes its imports with it and stays disabled through a navigation, and the undo restores all; `image-set()` strings serialise as `url()`; the client attaches no closed shadow root and shows no canvas or custom element; the Lua parser's long-string limitation that the base64 transport works around |

Names that start with `[watch]` assert a limitation the design works around (`_CTX` unset, HTML tables, the `fetch` bypass, `fullPage` ignored, the `{}` defect, …). When such a check fails the report says *changed*: the release removed the limitation, and the workaround and the document that describes it need a look.

## Report

`node test/run.ts` writes `report/<version>.md`: every assumption with pass / fail / changed / skip and the note, plus the measurements the checks took (cold start, render, screenshot, indexing delays, filter time). The report for the release the design was made against is committed; a new release gets its own file.

## Layout

* `lib/sb.ts`: a client for the file API, `/.config`, the Runtime API, the event stream and the admin API.
* `lib/env.ts`: the instance (URL, tokens) and the fixtures; `lib/lua.ts`: the render script and the state query; `lib/transform.ts`: the shipped transform block and the variants the checks compare it with.
* `server/`: the server's integration tests and their harness (`harness.ts`: configuration files, a spawned server, an MCP client per bearer).
* `seed/`: the pages of the test spaces.
* The write filter and the vendored parser are the server's, under `src/filter/`.
