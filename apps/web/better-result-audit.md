# Better-Result Adoption Audit (apps/web)

## Status: In progress, framework-safe boundaries preserved

### Fully covered by `better-result` flow

- `apps/web/src/convex/*.ts` action/query helpers in:
  - `analytics.ts`
  - `authHelpers.ts`
  - `cli.ts`
  - `cliInternal.ts`
  - `instances/actions.ts` (service helpers + helper `Result` plumbing)
  - `instances/queries.ts`
  - `http.ts` (boundary-safe throws moved to `WebUnhandledError`/`Result`
    error context)
  - `mcp.ts`
  - `mcpInternal.ts`
  - `mcpQuestions.ts` _(throws stay at boundary helper only)_
  - `messages.ts` _(throws stay at boundary helper only)_
  - `projects.ts`
  - `resources.ts`
  - `usage.ts`
- `apps/web/src/routes/api/**/+server.ts`
  - Added/kept `runConvexActionResult` + `handleConvexRouteResult` boundary adaptation
  - HTTP/error shape/status preserved
- `apps/web/src/lib/result/*`
  - `errors.ts` with shared `WebError` union + `toWebError`
  - `http.ts` with `toResult`, `toResultAsync`, route helpers
- `apps/web/src/lib/stores/*`
  - `project.svelte.ts`
  - `instance.svelte.ts`
  - `billing.svelte.ts`
  - `theme.svelte.ts`
  - `ShikiStore.svelte.ts`
  - Getters now go through `Result` internally with boundary `throw` at the final getter.

### Still throwing by design at framework/boundary layer

- Route redirects:
  - `apps/web/src/routes/commands/+page.server.ts`
  - `apps/web/src/routes/config/+page.server.ts`
  - `apps/web/src/routes/getting-started/+page.server.ts`
- Store context getters (UI boundary):
  - all five store modules above throw only after context miss resolution via `Result.match`
- Chat page component error throws:
  - `apps/web/src/routes/app/chat/[id]/+page.svelte` (UI/event-path local control flow)
- Convex compatibility throw adapters:
  - `apps/web/src/convex/mcpQuestions.ts`, `apps/web/src/convex/messages.ts`
    still throw typed `WebError` at endpoint boundaries.

### Not covered yet by this pass

- Full refactor of `apps/web/src/convex/instances/actions.ts` internals to eliminate all internal throws in favor of returning `Result` everywhere (the file now uses a typed boundary-safe `Result` approach, but retains internal throw-for-control-flow in low-level helpers).
