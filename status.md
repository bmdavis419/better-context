# Migration Status

## Current Status: `running`

**Valid statuses:**

- `running` - Migration in progress, agent should continue
- `done` - All tasks complete, agent should stop
- `error` - Critical issue requiring human intervention, agent should stop

---

## State

| Field               | Value                                        |
| ------------------- | -------------------------------------------- |
| Last Completed Task | Phase 11, Task 11.5 - Billing/usage tracking |
| Next Task           | Phase 11, Task 11.6 - Real-time UI updates   |
| Blocked By          | _None_                                       |
| Current Phase       | 11                                           |

---

## Progress Summary

| Phase                               | Status      | Notes                                                                              |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Phase 1: Schema & Data Model        | complete    | All tasks done; schema rewritten, stub Convex functions created, type check passes |
| Phase 2: Instance Functions         | in progress | Added instance mutations for lifecycle updates                                     |
| Phase 3: HTTP Actions               | complete    | CORS configured; Clerk webhook secret added to env templates                       |
| Phase 4: Scheduled Functions        | in progress | Added scheduled queries file to keep Node actions separate                         |
| Phase 5: Migrate Existing Functions | in progress | Refactored legacy users functions to instances wrappers                            |
| Phase 6: Remove SvelteKit Routes    | complete    | Autumn integration now routed through Convex actions; old server helpers removed   |
| Phase 7: Update Client Stores       | in progress | Billing store now uses Convex actions directly                                     |
| Phase 8: New UI Components          | complete    | Instance components wired to instance store                                        |
| Phase 9: Update Pages               | in progress |                                                                                    |
| Phase 10: Clerk Webhook Setup       | complete    | Webhook configured, secret set, provisioning verified                              |
| Phase 11: Testing & Migration       | in progress | Signup/provisioning checked; proceed through remaining checklist                   |
| Phase 12: Cleanup & Docs            | pending     |                                                                                    |

---

## Notes for Next Iteration

- Billing usage now refreshes after chat completion or 402/abort so UI reflects latest limits.
- Next: verify real-time UI updates in settings/usage and chat flows.

---

## Error Log

_No errors - CLERK_WEBHOOK_SECRET has been added to Convex env vars by the developer._

---

## Completed Tasks

- Phase 1, Task 1.1 - Rewrite Convex schema
- Phase 1, Task 1.2 - Delete old convex function files
- Phase 1, Task 1.3 - Verify schema deploys cleanly (includes creating stub functions and fixing type errors)
- Phase 2, Task 2.1 - Create instances directory
- Phase 2, Task 2.2 - Implement mutations.ts
- Phase 2, Task 2.3 - Implement actions.ts
- Phase 2, Task 2.4 - Add environment variables for Daytona API
- Phase 3, Task 3.1 - Create HTTP Router
- Phase 3, Task 3.2 - Implement `/chat/stream` HTTP action
- Phase 3, Task 3.3 - Implement `/instance/*` HTTP actions
- Phase 3, Task 3.4 - Implement `/webhooks/clerk` HTTP action
- Phase 3, Task 3.5 - Configure CORS for client origin
- Phase 3, Task 3.6 - Add Clerk webhook secret to env vars
- Phase 4, Task 4.1 - Create scheduled directory
- Phase 4, Task 4.3 - Implement version check
- Phase 5, Task 5.4 - Refactor `convex/users.ts` → `convex/instances/`
- Phase 6, Task 6.5 - Remove unused server-side imports
- Phase 9, Task 9.3 - Update settings pages
- Phase 11, Task 11.1 - New user signup → instance provisioned
- Phase 11, Task 11.2 - Instance wake/stop/update
- Phase 11, Task 11.5 - Billing/usage tracking
