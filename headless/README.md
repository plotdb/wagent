# @plotdb/wagent/headless

Headless renderer for [@plotdb/wagent](../README.md) — the observation channel
(`snapshot`) without a user's browser.

`snapshot` is the one required part of the wagent host contract, and it needs a
renderer. Node has no DOM, so running wagent server-side without this gives you an
agent that cannot see its own output — and seeing its own output is what makes the
agent work.

## The renderer holds no filesystem

It is fed **values, not paths** — the same principle blocks follow with `opt.data`:

    Node                                    headless page
    owns the fs / runs the agent loop  ──►   mount, settle, report
      {source, data, width, ...}       ◄──   {report, image}

Giving the headless page its own OPFS would mean two filesystems and a sync line to
maintain by hand. Don't.

## Usage

```js
const {createRenderer} = require('@plotdb/wagent/headless');

const r = await createRenderer({
  // libraries your blocks expect as globals — an application decision,
  // wagent bundles none of them
  scripts: ['https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js']
});

const {report, image} = await r.snapshot({
  name: 'monthly-bar',                  // label for the report only
  source: fs.readFileSync(file, 'utf8'),// required — the renderer does not read files
  data: {rows: [...]},                  // whatever your blocks expect in opt.data
  image: true,
  width: 900, height: 600
});

await r.close();
```

`report` comes from the sandbox itself (blank detection, canvas ink ratio, client
capabilities, change ratio). `image` is a **CDP screenshot** — the real composited
frame, not a snapdom foreignObject redraw, so cross-origin assets, CSS
filter/blend and WebGL all come out right, with no user gesture needed.

Options: `browser` (reuse one), `launch` (playwright launch options), `scripts`,
`sandbox` (path to wagent's `sandbox/base.html`), `width` / `height`.

## Install

Part of `@plotdb/wagent`. `playwright` is an optional peer dependency — the browser
binaries are large and whether you want them is a deployment decision, so it is only
needed if you require this entry.

    npm i playwright
    npx playwright install chromium

## Test

    node headless/test.js              # PW_EXEC=<chromium path> to use an existing build
