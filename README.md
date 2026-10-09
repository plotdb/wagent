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

    npm install github:plotdb/wagent#semver:^0.4.0

Backend - mount the router wherever you like:

    app.use('/api/agent', require('@plotdb/wagent')({preset: 'plain', purpose: '...'}));

options: `purpose` ( domain prompt ), `preset` ( `block` default / `plain` ), `log`,
`provider`, `model`, `models`, `rate`, `usage`, `budget`, `tune` - see `api/index.js`.
LLM keys come from env: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Which model to use is
per mount ( below ); `LLM_PROVIDER`, `ANTHROPIC_MODEL`, `OPENAI_MODEL` are the fallback.

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

## Models

Each mount decides which models its frontend may use, and the default:

    require('@plotdb/wagent')({
      provider: 'anthropic',                    // default provider ( else LLM_PROVIDER, else the first with a key )
      model: 'claude-opus-5-5',                 // default model; or {anthropic: '...', openai: '...'}
                                                // ( else ANTHROPIC_MODEL / OPENAI_MODEL, else built-in )
      models: {                                 // allow-list per provider, replaces the built-in one
        anthropic: ['claude-sonnet-5', 'claude-haiku-4-5'],
        openai: false                           // false or [] = not offered on this mount
      }
    })

 - the default model is always allowed, so setting `ANTHROPIC_MODEL` to a model the
   list doesn't know no longer breaks every call.
 - to extend instead of replace: `models: {anthropic: wagent.models.anthropic.concat(['...'])}`.
 - the proxy rejects ( 400 ) a `model` outside the mount's list, fills the default when
   the body has none, and 404s a provider the mount turned off.
 - with none of these options, behaviour is that of 0.3.0.

`GET <mount>/provider` - the menu for the frontend. `provider` / `model` are the
defaults ( same fields as 0.3.0 ); `providers` lists only those with a key:

    {provider: 'anthropic', model: 'claude-opus-5-5',
     providers: {anthropic: {model: 'claude-opus-5-5', models: ['claude-opus-5-5', ...]},
                 openai:    {model: 'gpt-5', models: [...]}}}

Switching in the middle of a conversation, from the runtime:

    rt.listModels()                // {current, default, providers}  ( {refresh: true} refetches )
    rt.getModel()                  // {provider, model} the next turn will use
    rt.setModel({provider, model}) // -> {provider, model}; rejects if not on the mount's list
    rt.setModel({model})           //    finds the provider itself
    rt.setModel({provider})        //    that provider's default model
    rt.setModel(null)              //    back to the backend default
    rt.onModelChange(fn)           // fn({provider, model}); returns an unsubscribe

The new model applies from the **next turn** ( a turn already running finishes on
the old one ) and the conversation is kept, for every session:

 - same provider: the history is reused as is. Thinking blocks of another model are
   ignored by the API. Haiku 4.5 and older Claude models don't take adaptive thinking,
   so it is not sent for them.
 - across providers ( anthropic ↔ openai ): the history is converted to the other
   wire format ( `client/runtime/providers/convert.js` ) and the session rebuilt with
   the same system prompt and tools. Tool calls stay paired with their results;
   thinking blocks are dropped; only the latest image is kept ( the prefix is new
   anyway ). Prompt cache starts over, as with any model change.

## Host tools

The application opens windows for the agent with `rt.registerHost(...)` ( design in
`context/project/host.md` ):

    rt.registerHost({
      snapshot: sb.snapshot,                    // required: how the agent sees what it made
      tools: [{name: 'gen_image', description: '...', parameters: {...},
               timeout: 90000}],                // ms, optional; per tool
      run: function(name, args) { ... },        // runs the tools above
      timeout: 30000,                           // ms, optional; snapshot + tools without their own
      brief: '...',                             // static: what this application is
      context: function() { ... }               // dynamic: the state now, fetched every turn
    })

A host call waits `tool.timeout`, else `registerHost({timeout})`, else 20s. `timeout` is
for the runtime only — it is never sent to the LLM. On timeout the agent is told the host
may still be working and that calling again right away will not help — so a slow tool
( image generation ) does not get re-run in a loop. Set the timeout above the tool's
real worst case; a result that arrives after it is dropped.

## Conversation history is append-only

Messages already sent to the provider are never edited — that is what keeps the prompt
cache hitting ( anthropic: the system block plus top-level automatic caching, so each step
reads the whole previous prefix from cache; openai caches prefixes on its own ) and what
current Claude models require of thinking blocks ( editing an earlier turn invalidates
them; new accounts get a 400 ).

 - `context()` is appended with every turn and earlier ones stay; the text says the
   newest one supersedes the rest.
 - images stay in the history ( re-sent from cache each step, ~1-2k tokens each ). Past
   `createRuntime({maxImages})` ( default 20 ) the history is rebuilt **once**: older
   images become `[earlier image omitted]` and thinking blocks are dropped, then it is
   append-only again. That costs one cache miss and the model's earlier reasoning —
   raise the cap if your agent looks at many pictures in one conversation.

## Progress events

A long model call ( an Opus reply writing a whole HTML file into a tool argument can run
for minutes ) shows nothing but "running" unless you surface what it is doing. The
runtime reports every LLM call, throttled to about one event per 250ms ( immediately on a
phase change ). They are display-only and never enter the conversation history.

    // chat block ( base or any derived look )
    chat.on('progress', function(p) { ... })
    // or straight from the transport
    rt.transport.send(text, {onProgress: function(p) { ... }})

 - `phase`: `waiting` ( request sent, nothing back yet ) · `thinking` · `text` · `tool`
   ( generating tool arguments ) · `done` · `error`
 - `tool`, `target`: the tool name, and a `path` / `file` argument when found in the
   first few hundred characters of the arguments
 - `outChars`, `outTokensEst` ( estimate: ~4 ASCII chars or 1 CJK char per token ),
   `outTokens` ( actual, on `done` )
 - `inTokens` with `inEstimated`: estimated from the request size until the API reports
   usage ( anthropic `message_start`, openai only at the end ), then the actual total
   including cache, split in `inDetail: {input, cacheRead, cacheWrite}`
 - `provider`, `model`, `step`, `startedAt`, `at`; `usage` and `stopReason` on `done`,
   `error` on `error`
 - the chat block adds `turn: {startedAt, calls, outTokens, inTokens}` for the whole turn

Field details are in `client/runtime/progress.js`. Count elapsed time yourself from
`startedAt` — events only arrive while output is streaming. The turn ends with the
chat block's `busy(false)`, not with a progress event.

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
