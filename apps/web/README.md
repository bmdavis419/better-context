# @btca/web

SvelteKit web app for btca. Convex now lives in `packages/convex`.

## Local development

From the repo root:

```sh
bun install
bun run dev:web
```

From `apps/web` directly:

```sh
bun run dev
```

From `packages/convex` directly:

```sh
bun run dev
```

## Vercel deployment

1. Import the monorepo into Vercel.
2. Set the project Root Directory to `apps/web`.
3. Keep the checked-in `vercel.json` so Vercel runs `bun run deploy:vercel`.
4. Add `CONVEX_DEPLOY_KEY` in Vercel for Production. If you use preview deployments, add a Preview-scoped `CONVEX_DEPLOY_KEY` too.
5. Add the web app's public env vars in Vercel:

```sh
PUBLIC_CLERK_PUBLISHABLE_KEY=
PUBLIC_POSTHOG_ID=
PUBLIC_ANALYTICS_HOST=
```

`PUBLIC_CONVEX_URL` is still injected during the Vercel build by the shared Convex package, so each deployment is built against the matching Convex deployment.

## Env split

- Vercel hosts the SvelteKit app and its public env vars.
- Convex still owns Convex function env vars like `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `DAYTONA_WEBHOOK_SECRET`, `POSTHOG_ID`, and other backend-only secrets.

## Notes

- The app now uses `@sveltejs/adapter-vercel`.
- Clerk production auth should use a custom domain, not a `*.vercel.app` URL.
