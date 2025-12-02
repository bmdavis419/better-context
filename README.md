# The Better Context App

```
bun add -g btca@latest
```

```
btca ask -t svelte -q "How does the inspect rune work?"
```

This is an evolution of: https://github.com/bmdavis419/opencode-hosted-docs-nonsense. Eventually I want to have this be the easiest way to pass in a piece of tech (ie. Svelte) and a question (ie. "How do remote functions work?") and get an up to date answer based on the latest version of the tech using the latest version of the docs/source code...

**_this is all scratch work right now, I'll remove this once it's more ready to go_**

## Installation

```sh
bun i
```

## Usage

### CLI - Ask a question

Ask a question about a specific technology directly from the command line:

```sh
bun run src/index.ts ask -t <tech> -q "<question>"
```

Example:

```sh
bun run src/index.ts ask -t effect -q "How does Effect.tap work?"
```

### HTTP Server

Start the HTTP server to accept questions via API:

```sh
bun run src/index.ts serve -p <port>
```

Example:

```sh
bun run src/index.ts serve -p 8080
```

Then make POST requests to `/question`:

```sh
curl -X POST http://localhost:8080/question \
  -H "Content-Type: application/json" \
  -d '{"tech":"effect","question":"How does Effect.tap work?"}'
```

Response:

```json
{ "answer": "..." }
```

### Help

```sh
bun run src/index.ts --help
bun run src/index.ts ask --help
bun run src/index.ts serve --help
```
