# @plotdb/wagent

An **agent-compatible editing host**: the agent works in a browser-local workspace
and — this is the part that matters — can see what it renders.

The package ( what `files` ships ):

    api/          backend: express router — llm proxy + system prompt   require('@plotdb/wagent')
    client/       browser: runtime ( agent worker, shell ) + chat / sandbox blocks
    headless/     renderer for when no user's browser is present        require('@plotdb/wagent/headless')

The rest of the repo is the demo site and its samples:

    server.js                    demo server
    web/src/pug/single-block     sample: one block at /index.html
    web/src/pug/multiple-blocks  sample: blocks/<name>/, with a read-only file tree
    web/src/pug/dataviz          sample page for the application in sample/dataviz
    sample/dataviz               an application with a domain — data flows to the block as a value
    lib/                         demo accounts / usage ( an application concern, not wagent's )
    context/project/host.md      the design record — read this first

## Use it

    npm install github:plotdb/wagent#semver:^0.3.0

Backend - mount the router wherever you like:

    app.use('/api/agent', require('@plotdb/wagent')({preset: 'plain', purpose: '...'}));

options: `purpose` ( domain prompt ), `preset` ( `block` default / `plain` ), `log`,
`models`, `rate`, `usage`, `budget`, `tune` - see `api/index.js`. LLM keys come from
env: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` ( `LLM_PROVIDER`, `ANTHROPIC_MODEL`,
`OPENAI_MODEL` optional ).

Frontend - `client/` is copied into your static assets, e.g. with fedep:

    "frontendDependencies": {"modules": [
      "@plotdb/esh",
      {"name": "@plotdb/wagent", "dir": "client"}
    ]}

which puts it at `/assets/lib/@plotdb/wagent/main/` - the default the runtime looks
for. Then `import('/assets/lib/@plotdb/wagent/main/runtime/client.js')` and
`createRuntime({api: '/api/agent', ...})`.

fedep only copies what *you* list, so wagent's own frontend dependencies are yours to
list too: `@plotdb/esh` always, `@plotdb/block` ( + proxise / semver / csscope /
rescope ) for the chat / sandbox blocks, `@zumer/snapdom` for sandbox images. They are
declared as `peerDependencies`; all but `@plotdb/esh` are optional, since a page that
only uses the runtime ( no chat / sandbox block ) needs none of them.

## Run the sample

    npm install
    npm run setup                             # fedep: copies frontend deps into web/static
    echo "ANTHROPIC_API_KEY=sk-..." > .env    # or OPENAI_API_KEY
    npm start                                 # random port, opens the browser
                                              # PORT=4000 to pin it, NO_OPEN=1 to not open

`setup` is not a `postinstall` on purpose: that would run in every project that
installs wagent. `client/` itself is served straight from the repo by `server.js`.

Three samples. The first two differ **only in topology** — wagent knows neither:

 - `/single-block/` — one block at `/index.html`. The smallest useful setup.
 - `/multiple-blocks/` — `blocks/<name>/index.html`, plus a read-only file tree on the
   left. Click a file to switch what the preview shows; ask the agent for a new block
   and it appears in the tree.

The third one shows the opposite side — an application that *does* have a domain:

 - `/dataviz/` — a spreadsheet is the source of truth. The block gets **values**
   (`opt.data`), never a path; the agent reads the same data as a read-only device file
   (`dev/sheet`) and writes it back through a `write_sheet` tool. Its domain prompt is
   mounted separately at `/api/dataviz`. See `sample/dataviz/README.md`.

## The shape of it

    application    your code. owns the document, decides when to redraw,
                   decides what the agent can see
    wagent / host  the interface framework. knows no domain
      agent loop / shell (esh + OPFS) / sandbox

The backend does three things: forward LLM requests with the key attached, serve the
system prompt, report which provider is configured. The agent loop, the workspace and
every tool run in the browser.

`web/src/pug/single-block/index.ls` is the whole application layer of that sample —
about 130 lines, commented as a walkthrough. Start there, then read
`multiple-blocks/index.ls` for the file tree and the `open_block` host tool.
(`index.pug` is markup only, `index.styl` is styling; both are pulled in with `include`.)

## Release

    npm run release                           # npx fedep publish -g --skip-dist

publishes `files` to the `release` branch and tags it `dist/vX.Y.Z` / `vX.Y.Z`
( the source commit gets `src/vX.Y.Z` ). Bump `version` and `CHANGELOG.md` first.
