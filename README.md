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

options: `purpose` ( domain prompt ), `preset` ( `block` default / `plain` ), `lang` ( `zh` default / `en`,
see Language below ), `log`,
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
only uses the runtime ( no chat / sandbox block ) needs none of them. `marked` +
`dompurify` ( markdown in chat messages, see below ) are loaded by the page and are not
peer dependencies: the backend that installs wagent often pins its own `marked` for
unrelated build tools, and a peer range would only make that install fail.

## Language

What the model sees ( system prompt, runtime notes ) and the proxy's errors can be in Chinese
( `zh`, the default — unchanged from 0.7 ) or English ( `en` ). Set it once on the mount; the runtime
follows it. The chat / sandbox UI is localized separately, with block i18n ( below ):

    app.use('/api/agent', require('@plotdb/wagent')({lang: 'en', purpose: '...'}));

 - backend: the system prompt ( both presets ) and the quota errors the proxy returns. An unknown
   value throws at mount time, like `preset`. `purpose` is yours and is passed through as is —
   write it in the language you want. `GET <mount>/provider` and `GET <mount>/prompt` report `lang`.
 - runtime: `createRuntime({lang})` is optional; without it the runtime asks the mount
   ( `GET <mount>/provider` ) and falls back to `zh`. It sets the language of the notes the runtime
   adds for the model ( per-turn context, step limit, truncation, interruption, the compaction
   summary header ) and is exposed as `rt.lang`. The system prompt always comes from the mount.
 - chat / sandbox blocks: their UI strings use **@plotdb/block's own i18n** ( below ), not the mount's
   `lang` — the page decides the UI language the same way it does for its other blocks.

### Block UI strings

The chat and sandbox blocks keep their strings as `pkg.i18n` resources ( `en`, `zh`, `zh-TW` ) with
semantic keys. Static markup uses `t="key"` / `t-placeholder="key"`, which @plotdb/block translates when
the DOM is created ( and again on `languageChanged` if the host attaches with `autoTransform: 'i18n'`;
the blocks also listen to `languageChanged` themselves for their static strings ). A string is looked up in this order:

 1. `data.strings[key]` - a string ( same placeholders ), or `function(params)` returning one
 2. `data.lang` - if given, wagent's built-in resource for that language is used directly
    ( `zh-TW` -> `zh-TW`, `zh-HK` -> `zh`, unknown -> `en` ). Block i18n is bypassed, so `extend`
    overrides do **not** apply in this mode.
 3. block i18n - the instance's `t()`: `[<derived block>:key, ...extended blocks:key, key]` in
    `block.i18n`'s current language ( the default module starts at `en`; switch with
    `block.i18n.changeLanguage('zh-TW')` or `block.i18n.use(i18next)` ).
 4. not found ( the lookup returns the key itself ) -> the built-in `en` string.

To override strings the block way, extend the block and give your own resources; keys you leave out
fall through to wagent's:

    <div><script type="@plotdb/block">
    module.exports = {
      pkg: {
        name: 'my-chat', version: 'main',
        extend: {name: '@plotdb/wagent', path: 'block/chat/index.html'},
        i18n: {en: {send: 'Go', greetEdit: 'Working on {name}.'}, 'zh-TW': {send: '送'}}
      },
      init: function() {}
    };
    </script></div>

The default i18n module does no interpolation, so dynamic strings carry `{placeholders}` that wagent
fills in itself — an override must use the same names. A custom view built on `chat/base.html` or
`sandbox/base.html` gets the same order with `base.translator(myResources)` -> `tr(key, params)`;
`base.tr(key, params)` ( chat ) reads chat-base's own strings.

chat, view ( `client/block/chat/index.html` ):

| key | en | placeholders |
|---|---|---|
| `autoFixLabel` / `autoFixTitle` | Auto-fix errors / tooltip | |
| `autoFixOn` / `autoFixOff` | message when toggled | |
| `modelTitle` | model menu tooltip | |
| `placeholder` | input placeholder | |
| `send` / `sendQueued` | Send / Queue | |
| `queuedTitle` | tooltip on a queued message | |
| `thinking` / `working` | Thinking… / Working… | |
| `noReply` | (no reply) | |
| `error` | Error: … | `{message}` |
| `verb.write_file` `verb.edit_file` `verb.read_file` `verb.run_shell` `verb.snapshot` | status-line verbs | |
| `phaseWaiting` `phaseThinking` `phaseText` `phaseError` `phaseBetween` | status-line phases | |
| `tokens` | tokens | |
| `turn` | this turn … | `{time}` `{calls}` `{out}` |
| `fixLimit` / `fixFailed` | fix offer text | `{message}` |
| `fixButton` / `fixSent` / `fixSentNote` | fix offer button and note | |
| `newTitle` | New block | |
| `greetEdit` / `greetNew` | first message | `{name}` ( greetEdit ) |
| `noKey` | No API key configured (.env) | |
| `modelNext` / `modelFailed` | model switch messages | `{provider}` `{model}` / `{message}` |

chat, base ( `client/block/chat/base.html` ) - `fixRequest` is sent **to the agent**:

| key | placeholders |
|---|---|
| `noTransport` | |
| `compacted` / `compactFailed` | `{error}` ( compactFailed ) |
| `fixRequest` | `{name}` `{message}` |
| `fixGaveUp` | |
| `fixTrying` | `{n}` `{max}` |

sandbox ( `client/block/sandbox/index.html` ): `choose`, `refresh`, `empty`, `failed` ( `{message}` ).

`data.strings` keys are flat ( `'verb.write_file'` ). The snapshot report the agent reads is English
regardless.

## Chat message formatting

The chat base block renders the model's text as markdown by default. A view layer calls

    base.render(el, text, {final})   // draw text into el; call again while streaming, final = complete
    base.format(text)                // just the sanitized html string
    base.widget(name, fn)            // register an interactive element ( below )

It needs `window.marked` ( >= 5, for the `Marked` class ) and `window.DOMPurify` on the
page; without either it falls back to plain text rather than render unsanitized html.
`data.markdown = false` turns markdown off. Model output is treated as untrusted: raw html
is shown as text, everything goes through DOMPurify, links open in a new tab.

Extension point for interactive elements - the model writes a fenced block

    ```wagent:<name>
    <spec, e.g. JSON>
    ```

which becomes a placeholder handed to `fn(spec, {el, send, name})` registered with
`base.widget(name, fn)`, once the message is complete. Unregistered names show as a code
block. Describe the widget's format in your prompt so the model knows when to use it.

## Saving conversations

The agent's conversation lives in the worker's memory. To keep it across page loads
( or devices, or years ), the host saves it after each turn and imports it next time:

    rt.sessions.export(key, {images: 1})   // what the model sees: {v, provider, model, format, history}
                                           // images: keep only the newest n screenshots in the copy
    rt.sessions.import(key, data)          // use it from the next turn on ( converted if the provider differs )
    base.transcript()                      // chat base: the full log for people to read ( never compacted )
    base.restore(list)                     // put it back; views redraw on the 'restore' event

`key` is the chat session ( `data.session` of the chat block ) - give the chat block a stable
one, or the session id is random per page load. Storage is the host's business.

Long conversations get compacted: `createRuntime({compact: {at, keep, provider, model}})`
( or `rt.setCompact(...)` ) summarises everything but the last `keep` turns with the given
( usually cheap ) model once the history is estimated above `at` tokens, before a turn
starts. That is the only time the prefix changes; thinking blocks in the kept turns are
dropped because they are bound to the old prefix. The chat log is unaffected.

A turn that fails midway keeps the steps already done when the error is retryable
( credits / quota, throttling, upstream, abort, network, 5xx ) and ends with a short
interruption note, so "continue" picks up where it stopped. Other errors ( e.g. 400 )
roll the turn back as before.

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
                 openai:    {model: 'gpt-5', models: [...]}},
     lang: 'zh'}                                // the mount's language ( 0.8.0 )

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
