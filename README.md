# @plotdb/wagent

An **agent-compatible editing host**: the agent works in a browser-local workspace
and — this is the part that matters — can see what it renders.

    packages/wagent            the host: api (llm proxy + prompt) + web (runtime, chat, sandbox)
    packages/wagent-headless   renderer for when no user's browser is present
    web/src/pug/single-block     sample: one block at /index.html
    web/src/pug/multiple-blocks  sample: blocks/<name>/, with a read-only file tree
    context/project/host.md    the design record — read this first

## Run the sample

    npm install
    echo "ANTHROPIC_API_KEY=sk-..." > .env    # or OPENAI_API_KEY
    npm start                                 # prints the URL — the port is random
                                              # (PORT=4000 npm start to pin it)

Two samples, differing **only in topology** — wagent knows neither:

 - `/single-block/` — one block at `/index.html`. The smallest useful setup.
 - `/multiple-blocks/` — `blocks/<name>/index.html`, plus a read-only file tree on the
   left. Click a file to switch what the preview shows; ask the agent for a new block
   and it appears in the tree.

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
