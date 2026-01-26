# First Pass State (Effect Rewrite)

## Implemented
- Added Effect dependency to `apps/server` and `apps/cli`.
- Server:
  - Added `apps/server/src/effect/services.ts` (Context tags + service provisioning).
  - Rewrote all Hono route handlers in `apps/server/src/index.ts` to run via Effect, with service lookup and effectful metrics/logging.
- CLI:
  - Added Effect helpers: `apps/cli/src/effect/runner.ts`, `apps/cli/src/effect/server-manager.ts`, `apps/cli/src/effect/cli-exit.ts`.
  - Converted commands to Effect execution with scoped server lifecycle:
    - `ask`, `add`, `remove`, `clear`, `connect`, `config`, `repl`, `chat`, `serve`.
  - Removed manual `server.stop()` calls where `withServer` handles cleanup.
- Tests:
  - Added `apps/server/src/stream/service.effect.test.ts` to validate SSE output and question stripping.

## Not Yet Converted (Next Steps)
- CLI commands still imperative:
  - `apps/cli/src/commands/remote.ts`
  - `apps/cli/src/commands/init.ts`
  - `apps/cli/src/commands/tui.ts` (kept as-is for now)
- Potential refactor: move remaining CLI helpers to effectful services (prompts, filesystem, remote client).
- Consider adding more tests around Config/Resources/Collections or CLI runner.

## Compatibility Notes
- No changes to HTTP route paths, JSON shapes, or CLI flags.
- SSE event shapes remain unchanged.
