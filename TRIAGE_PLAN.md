# Issue triage plan

## Summary

- Create three Graphite stacks for grouped review: P0/P1, P2, Deferred/Close.
- Base branch for all stacks: current branch.
- Each stack adds a small TODO checklist for its section.

## P0/P1 Fix Now

### Implementation TODOs (P0/P1)

- [x] #140 add structured error reporting and surface instance start errors with retry
- [x] #101 verify linux-arm64 artifact is published; add prepublish artifact check
- [x] #135/#121 refine @mention parsing to ignore non-resource @ tokens; close dup
- [x] #138 detect WSL and use clip.exe for clipboard
- [x] #90 normalize Windows paths (WSL drive mapping) before validation
- [x] #124 strip echoed prompt during streaming to avoid UI flash
- [x] #136 remove hover translateY flicker (use shadow/overlay)

1. #140 Web Instance unable to start (P0)
   - Add structured error reporting in `apps/web/src/convex/instances/actions.ts` and surface a clear UI error + retry.
   - Improve logging around Daytona sandbox start and btca health checks to isolate root cause.

2. #101 ENOENT: missing btca-linux-arm64 binary (P0)
   - Ensure linux-arm64 artifact is built/published; add a prepublish check that validates required `dist/*` files.
   - If cross-compile is flaky, build linux-arm64 on native arm64 CI runner.

3. #135 Parsing out the @ symbols for CLI (P0)
4. #121 Resource not found when "@" is mid-question (P0)
   - Treat only valid resource @mentions as selectors; ignore unmatched @ sequences in the question.
   - Close #121 as duplicate once #135 fix ships.

5. #138 WSL copy to clipboard not working (P1)
   - Detect WSL and prefer `clip.exe` (fallback to xclip/xsel for non-WSL Linux).

6. #90 Windows local file path not found (P1)
   - If running in WSL, normalize `C:\path` -> `/mnt/c/path` before validation.

7. #124 [web] Prompt appears at start of AI response (P1)
   - Strip echoed question during streaming (server-side preferred) to avoid visible flash.

8. #136 Hover flicker loop on buttons with lift effect (P1)
   - Replace hover translateY with shadow/outline, or add overlay to avoid hover target shift.

## P2 Plan Soon

### Implementation TODOs (P2)

- [x] #129 add hide-thinking flag/config for CLI and UI outputs
- [x] #94 add official btca opencode tool/plugin + docs
- [x] #91 add clean output mode to suppress reasoning/tool traces
- [x] #63 add resume flow for existing chat sessions

1. #129 Option to hide thinking
   - Add CLI/config flag to suppress reasoning output (default on).

2. #94 btca opencode tool/plugin
   - Provide an official tool/plugin file + docs.

3. #91 Filter reasoning + tool-call traces (sub-agent mode)
   - Add a clean output mode that hides reasoning + tool call logs.

4. #63 Resume a session started with btca chat
   - Add `btca chat --thread <id>` and a thread list picker.

## Deferred/Close

### Deferred/Close Notes

- [x] #93 document deferral rationale and revisit after permissions model is defined
- [x] #97 verify rewrite covers tool toggles, then close with pointer to new config

1. #93 Opt-in: allow btca to read files outside the collection
   - Defer due to security/permissions complexity.
   - Rationale: needs scoped consent + audit trail before allowing reads outside configured resources.

2. #97 Config options to enable/disable custom tools
   - Close after verifying rewrite already provides this.
   - Verified: rewrite uses `btca.config.jsonc` with fixed tool surface; no custom tool toggles needed.

## Acceptance / checks

- Run: `bun run check:all`
- Run: `bun run format:all`

## Assumptions

- #121 is a duplicate of #135 after the parser fix.
- #97 is resolved by the rewrite; only verify and close.
- Only documentation changes are required for this initial stack setup.
