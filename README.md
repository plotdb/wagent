# @plotdb/wagent

An **agent-compatible editing host**: the agent works in a browser-local workspace
and — this is the part that matters — can see what it renders.

    packages/wagent            the host: api (llm proxy + prompt) + web (runtime, chat, sandbox)
    packages/wagent-headless   renderer for when no user's browser is present
    web/src/pug                a minimal sample application
    context/project/host.md    the design record — read this first

## Run the sample

    npm install
    echo "ANTHROPIC_API_KEY=sk-..." > .env    # or OPENAI_API_KEY
    npm start                                 # http://localhost:3000

The sample edits a single block (`/index.html` in a browser-local workspace).
Talk to it and watch the preview redraw.

## The shape of it

    application    your code. owns the document, decides when to redraw,
                   decides what the agent can see
    wagent / host  the interface framework. knows no domain
      agent loop / shell (esh + OPFS) / sandbox

The backend does three things: forward LLM requests with the key attached, serve the
system prompt, report which provider is configured. The agent loop, the workspace and
every tool run in the browser.

`web/src/pug/index.ls` is the whole application layer of the sample — about 140 lines,
commented as a walkthrough. Start there. (`index.pug` is markup only; `index.styl` is
styling; both are pulled in with `include`.)
