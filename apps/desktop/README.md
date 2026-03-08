# @btca/desktop

Bundled Tauri + SvelteKit desktop frontend for btca.

## How it works

- The desktop app now ships its own SvelteKit frontend inside Tauri
- App UI code is copied from `apps/web` and kept close to the web app's authenticated `/app` experience
- Server-backed flows still go over HTTP to the web app server via `PUBLIC_BACKEND_BASE_URL`
- In development, `PUBLIC_BACKEND_BASE_URL` defaults to `http://localhost:5173`
- Shared public env for Clerk and Convex is loaded from the `apps/web` env directory so the desktop app can stay aligned with the current stack

## Dev

1. Install workspace dependencies from the repo root:

```sh
bun install
```

2. Start the full desktop stack from the repo root:

```sh
bun run dev:desktop
```

3. `dev:desktop` runs Convex, the web app, and the Tauri desktop app together.

4. The desktop frontend dev server runs on `http://localhost:1420`, and server-backed flows target `PUBLIC_BACKEND_BASE_URL`.

## Env

- `PUBLIC_BACKEND_BASE_URL`
  Defaults to `http://localhost:5173` in dev
  Falls back to `https://btca.dev` outside dev
  Set this for non-default backend targets

## Notes

- The desktop app no longer embeds the hosted site
- It still depends on the web server for MCP URLs, billing redirects, and any other same-origin HTTP flows that are not bundled into the desktop frontend
