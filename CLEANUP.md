# Cleanup: Temporary Migration Files

These files were added for the per-user BTCA instance migration and should be **deleted** before publishing.

## Files to Delete

```bash
# Run this from the project root to clean up:
rm -f MIGRATION_PLAN.md
rm -f status.md
rm -f deej.sh
rm -f CLEANUP.md
```

## File List

| File              | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `MIGRATION_PLAN.md` | Detailed migration plan with task checkboxes |
| `status.md`         | Agent loop state tracking                    |
| `deej.sh`           | Autonomous agent loop script                 |
| `CLEANUP.md`        | This file (meta, I know)                     |

## When to Clean Up

Delete these files when:

- [ ] All migration tasks are complete
- [ ] `status.md` shows `done`
- [ ] App is tested and working
- [ ] Ready to commit/publish

## Notes

- The `btca.config.jsonc` changes (added `convexDocs` and `daytonaSdk` resources) are **keepers** - don't revert those
- Any changes to `apps/chat-web/` are the actual migration work and should stay
