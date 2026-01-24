# Better Context (btca) - Issue Implementation Plan

This document outlines the implementation plans for priority bug fixes and features, as well as a roadmap for future work.

---

## Table of Contents

1. [Priority Fixes - Detailed Plans](#priority-fixes---detailed-plans)
   - [Issue #99: Clean up OpenCode instances on app exit](#issue-99-clean-up-opencode-instances-on-app-exit)
   - [Issue #76: searchPath validation](#issue-76-searchpath-validation)
   - [Issue #81: .btca folder location improvements](#issue-81-btca-folder-location-improvements)
   - [Issue #96: Code block scroll on website](#issue-96-code-block-scroll-on-website)
2. [Future Work - Deferred Issues](#future-work---deferred-issues)
   - [Issue #109: Model validation for opencode gateway](#issue-109-model-validation-for-opencode-gateway)
   - [Issue #105 & #89: Windows Platform Issues](#issue-105--89-windows-platform-issues)
   - [Issue #91: Sub-agent mode filtering](#issue-91-sub-agent-mode-filtering)
   - [Issue #63: Session resume](#issue-63-session-resume)
   - [Issue #108: Input history](#issue-108-input-history)
   - [Issue #94, #97, #93: OpenCode Integration Features](#issue-94-97-93-opencode-integration-features)

---

## Priority Fixes - Detailed Plans

---

### Issue #99: Clean up OpenCode instances on app exit

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/99

**Problem Statement:**
The application creates OpenCode instances (server-side) but doesn't shut them down when the caller exits. This leads to orphaned processes that consume system resources. The issue affects any code path that calls `/opencode`, not just `btca chat`.

**Current Behavior:**

- `createOpencodeInstance()` in `apps/server/src/agent/service.ts` creates a server on a random port
- The `getOpencodeInstance()` method explicitly states: "The server stays alive - it's the caller's responsibility to manage the lifecycle"
- No tracking of created instances
- No cleanup endpoint
- No signal handling for graceful shutdown

**Root Cause Analysis:**

1. OpenCode servers are created but only closed in the `askStream` flow (line 363: `server.close()`)
2. The `getOpencodeInstance` method (lines 384-404) never closes the server
3. No instance registry exists to track active servers
4. CLI has no signal handlers to clean up on exit

---

#### Implementation Plan

##### Phase 1: Server-Side Instance Tracking

**File:** `apps/server/src/agent/service.ts`

1. **Create an Instance Registry**

   ```
   Location: Top of Agent namespace (after line 14)

   Add:
   - Type definition for TrackedInstance: { id: string, server: { close(): void }, createdAt: Date, lastActivity: Date }
   - Map<string, TrackedInstance> to store active instances
   - Helper functions: generateInstanceId(), registerInstance(), unregisterInstance()
   ```

2. **Modify `createOpencodeInstance()` function**

   ```
   Location: Lines 191-225

   Changes:
   - Generate unique instanceId (uuid or nanoid)
   - Register the server in the instance map after successful creation
   - Return instanceId along with client, server, and baseUrl
   ```

3. **Update `getOpencodeInstance()` method**

   ```
   Location: Lines 384-404

   Changes:
   - Store the instanceId from createOpencodeInstance
   - Return instanceId in the response object alongside url and model
   - Update return type to include instanceId
   ```

4. **Add Instance Management Methods to Service**

   ```
   Location: After line 439 (before the return statement)

   Add new methods:
   - closeInstance(instanceId: string): Promise<void>
     - Look up instance in registry
     - Call server.close()
     - Remove from registry
     - Log closure

   - listInstances(): { id: string, createdAt: Date, lastActivity: Date }[]
     - Return list of active instances

   - closeAllInstances(): Promise<{ closed: number }>
     - Iterate through registry
     - Close all servers
     - Clear registry
     - Return count
   ```

##### Phase 2: HTTP Endpoints

**File:** `apps/server/src/index.ts`

1. **Add DELETE endpoint for single instance**

   ```
   Route: DELETE /opencode/:id

   Implementation:
   - Extract instanceId from params
   - Call agent.closeInstance(instanceId)
   - Return 200 with { closed: true } on success
   - Return 404 if instance not found
   ```

2. **Add GET endpoint to list instances**

   ```
   Route: GET /opencode/instances

   Implementation:
   - Call agent.listInstances()
   - Return 200 with array of instance info
   ```

3. **Add DELETE endpoint to close all instances**

   ```
   Route: DELETE /opencode/instances

   Implementation:
   - Call agent.closeAllInstances()
   - Return 200 with { closed: count }
   ```

##### Phase 3: Client-Side Cleanup

**File:** `apps/cli/src/client/index.ts`

1. **Add client method for closing instances**
   ```
   Add function: closeOpencodeInstance(baseUrl: string, instanceId: string): Promise<void>
   - Make DELETE request to /opencode/:id
   - Handle errors appropriately
   ```

**File:** `apps/cli/src/commands/chat.ts` (or wherever opencode is invoked)

2. **Implement signal handlers**
   ```
   Add at command initialization:
   - Track current instanceId when /opencode is called
   - Register handlers for: SIGINT, SIGTERM, SIGHUP
   - On signal: call closeOpencodeInstance() before exit
   - Use try/finally pattern to ensure cleanup
   ```

**File:** `apps/cli/src/tui/context/messages-context.tsx`

3. **Add cleanup to TUI context**
   ```
   Changes:
   - Store active instanceId in context state
   - Add cleanup function that closes instance
   - Call cleanup on unmount / app exit
   ```

##### Phase 4: Server-Side Safety Net (Optional but Recommended)

**File:** `apps/server/src/agent/service.ts`

1. **Add idle timeout cleanup**

   ```
   Implementation:
   - Add configurable IDLE_TIMEOUT_MS constant (default: 5 minutes)
   - Create cleanup interval that runs every minute
   - Check lastActivity timestamp for each instance
   - Close instances that exceed idle timeout
   - Log cleanup actions
   ```

2. **Update lastActivity on instance use**
   ```
   Changes:
   - When askStream or any method uses an instance, update lastActivity
   - This keeps active instances alive while cleaning up forgotten ones
   ```

---

#### Testing Plan

1. **Unit Tests**
   - Test instance registration and unregistration
   - Test closeInstance with valid/invalid IDs
   - Test closeAllInstances

2. **Integration Tests**
   - Start btca, create instance, verify it's tracked
   - Close instance via endpoint, verify it's removed
   - Kill CLI process, verify server-side cleanup (via idle timeout)

3. **Manual Testing**
   - Run `btca chat`, start a session, Ctrl+C out
   - Use `htop` or `ps` to verify no orphaned processes
   - Test with multiple concurrent instances

---

#### Files to Modify

| File                                            | Changes                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `apps/server/src/agent/service.ts`              | Instance registry, tracking, cleanup methods |
| `apps/server/src/agent/types.ts`                | New type definitions for tracked instances   |
| `apps/server/src/index.ts`                      | New HTTP endpoints                           |
| `apps/cli/src/client/index.ts`                  | Client cleanup method                        |
| `apps/cli/src/commands/chat.ts`                 | Signal handlers                              |
| `apps/cli/src/tui/context/messages-context.tsx` | Cleanup on unmount                           |

---

#### Acceptance Criteria

- [x] OpenCode instances are tracked with unique IDs
- [x] `DELETE /opencode/:id` endpoint closes specific instance
- [x] `GET /opencode/instances` lists active instances
- [ ] CLI cleans up instances on SIGINT/SIGTERM (future enhancement)
- [ ] Idle instances are cleaned up after timeout (future enhancement - safety net)
- [x] No orphaned processes after normal or abnormal exit (via API)
- [x] Existing functionality remains unchanged

---

### Issue #76: searchPath validation

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/76

**Problem Statement:**
When a user configures a resource with an invalid `searchPath` (a path that doesn't exist in the cloned repository), btca doesn't validate this. Instead, it either:

1. Falls back to searching unrelated directories (like `~/.claude/`)
2. Hallucinates answers based on non-existent content

This leads to confusing, incorrect responses that appear authoritative.

**Current Behavior:**

- Git repos are cloned to `{resourcesDirectory}/{resourceKey}/`
- `searchPath` is used to focus on a subdirectory
- No validation that `searchPath` actually exists after clone
- Collection is created with potentially invalid paths

**Example from Issue:**

```json
{
	"searchPath": "tree/dev/packages/web/src/content/docs" // Invalid - "tree/dev" is GitHub UI path
}
```

Should have been:

```json
{
	"searchPath": "packages/web/src/content/docs" // Correct - actual repo path
}
```

---

#### Implementation Plan

##### Phase 1: Add searchPath Validation to Git Resource Loading

**File:** `apps/server/src/resources/impls/git.ts`

1. **Create validation function**

   ```
   Location: Add new function after clone logic

   Function: validateSearchPaths(repoPath: string, searchPaths: string[]): { valid: string[], invalid: string[] }

   Implementation:
   - For each searchPath, check if path exists using Bun.file().exists() or fs.stat()
   - Handle both searchPath (single) and searchPaths (array) from config
   - Return object with valid and invalid paths
   ```

2. **Integrate validation after clone**

   ```
   Location: After successful git clone/pull

   Implementation:
   - Call validateSearchPaths with the cloned repo path
   - If any paths are invalid, throw a descriptive error
   - Include: invalid path, repo name, suggestion to check config
   ```

3. **Create specific error class**

   ```
   Location: Add to errors or within git.ts

   Class: InvalidSearchPathError extends Error
   Properties:
   - resourceName: string
   - invalidPaths: string[]
   - repoPath: string
   - hint: string (helpful message about common mistakes)
   ```

##### Phase 2: Improve Error Messages

**File:** `apps/server/src/resources/impls/git.ts`

1. **Add helpful hints for common mistakes**

   ```
   Common patterns to detect and suggest fixes:

   - Path starts with "tree/" or "blob/"
     → "Remove 'tree/{branch}/' prefix - use the actual repository path"

   - Path starts with "https://" or "github.com"
     → "searchPath should be a relative path within the repo, not a URL"

   - Path contains branch name that matches configured branch
     → "The branch is already specified in 'branch' field - just use the path after it"
   ```

2. **Format error message clearly**

   ```
   Example output:

   Error: Invalid searchPath for resource "opencode"

   Path not found: "tree/dev/packages/web/src/content/docs"
   Repository: ~/.local/share/btca/resources/opencode

   Hint: It looks like you included the GitHub URL structure.
   Remove 'tree/dev/' prefix and use: "packages/web/src/content/docs"

   To see available directories, run:
     ls ~/.local/share/btca/resources/opencode
   ```

##### Phase 3: Validation at Config Time (Optional Enhancement)

**File:** `apps/server/src/config/index.ts`

1. **Add validation when adding resources**

   ```
   Location: In addResource method

   Implementation:
   - For git resources with searchPath, note that validation will happen on first load
   - Consider adding a "validate" flag or separate validation command
   - This is optional since full validation requires cloning first
   ```

**File:** `apps/cli/src/commands/config.ts`

2. **Add validation command**

   ```
   New command: btca config resources validate

   Implementation:
   - Load all git resources
   - Clone/update each one
   - Validate searchPaths
   - Report any issues
   - Useful for debugging config issues
   ```

##### Phase 4: Update Collection Creation

**File:** `apps/server/src/collections/service.ts`

1. **Add validation before creating collection**

   ```
   Location: Before symlink creation

   Implementation:
   - Verify all resource paths exist
   - If searchPath is specified, verify it exists within the resource
   - Fail fast with clear error rather than creating partial collection
   ```

---

#### Testing Plan

1. **Unit Tests**
   - Test validateSearchPaths with valid paths
   - Test validateSearchPaths with invalid paths
   - Test hint generation for common mistakes
   - Test error message formatting

2. **Integration Tests**
   - Configure resource with invalid searchPath, verify error
   - Configure resource with GitHub URL-style path, verify helpful hint
   - Configure resource with valid searchPath, verify success

3. **Manual Testing**
   - Reproduce the exact scenario from the issue
   - Verify the error message is helpful
   - Test the suggested fix works

---

#### Files to Modify

| File                                     | Changes                                       |
| ---------------------------------------- | --------------------------------------------- |
| `apps/server/src/resources/impls/git.ts` | Validation function, error class, integration |
| `apps/server/src/collections/service.ts` | Pre-collection validation                     |
| `apps/server/src/errors.ts`              | New error type (optional, could be in git.ts) |
| `apps/cli/src/commands/config.ts`        | Optional: validation command                  |

---

#### Acceptance Criteria

- [ ] Invalid searchPath throws clear error before querying
- [ ] Error message includes the invalid path and resource name
- [ ] Helpful hints detect common mistakes (GitHub URL patterns, etc.)
- [ ] Suggested fix is actionable (shows correct path format)
- [ ] Valid searchPaths continue to work as before
- [ ] Collection creation fails fast with invalid paths

---

### Issue #81: .btca folder location improvements

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/81

**Problem Statement:**
When btca creates a `.btca/` folder in a user's project directory, it causes several issues:

1. `git status` shows `.btca/` as untracked
2. `git add .` triggers embedded repository warnings
3. Users may accidentally commit external repos
4. Each project gets its own clone cache (wasted disk space)

**Current Behavior:**

- Global data defaults to `~/.local/share/btca/`
- Project config can set `dataDirectory: ".btca"` which creates local folder
- Legacy migration (lines 709-726 in config) preserves existing `.btca/` folders
- No automatic `.gitignore` management

**Goal:**

- Add a `btca init` command for explicit project setup
- Automatically add `.btca/` to `.gitignore` when using local data directory
- Warn users about potential git issues

---

#### Implementation Plan

##### Phase 1: Add `btca init` Command

**File:** `apps/cli/src/commands/init.ts` (new file)

1. **Create new init command**

   ```
   Command: btca init

   Options:
   - --local / -l: Use local .btca directory (default: use global)
   - --force / -f: Overwrite existing config

   Behavior:
   - Check if btca.config.jsonc already exists
   - If exists and no --force, warn and exit
   - Create btca.config.jsonc with appropriate defaults
   - If --local, set dataDirectory: ".btca"
   - If --local, update .gitignore
   ```

2. **Define init command structure**

   ```
   Implementation steps:

   a) Check for existing config
      - Look for btca.config.jsonc in cwd
      - If exists, prompt or error based on --force

   b) Determine data directory strategy
      - Default: inherit from global (no dataDirectory field)
      - With --local: set dataDirectory: ".btca"

   c) Create config file
      - Use CONFIG_SCHEMA_URL for $schema
      - Set reasonable defaults (empty resources array, inherit model/provider)
      - Write to btca.config.jsonc

   d) Handle .gitignore (if --local)
      - Check if .gitignore exists
      - If exists, check if .btca is already listed
      - If not listed, append .btca/ entry
      - If .gitignore doesn't exist, create with .btca/ entry

   e) Print success message with next steps
   ```

**File:** `apps/cli/src/index.ts`

3. **Register the init command**

   ```
   Location: With other command registrations

   Add:
   - Import initCommand from './commands/init.ts'
   - Register with program.addCommand(initCommand)
   ```

##### Phase 2: Gitignore Management Utilities

**File:** `apps/cli/src/lib/utils/gitignore.ts` (new file)

1. **Create gitignore helper functions**

   ```
   Functions:

   - hasGitignore(dir: string): Promise<boolean>
     - Check if .gitignore exists in directory

   - isPatternInGitignore(dir: string, pattern: string): Promise<boolean>
     - Read .gitignore and check if pattern exists
     - Handle comments and variations (.btca, .btca/, .btca/*)

   - addToGitignore(dir: string, pattern: string, comment?: string): Promise<void>
     - Append pattern to .gitignore
     - Add optional comment above (e.g., "# btca local data")
     - Create .gitignore if it doesn't exist
     - Ensure newline handling is correct
   ```

##### Phase 3: Automatic Gitignore Updates

**File:** `apps/server/src/config/index.ts`

1. **Add gitignore check on project config creation**

   ```
   Location: In the legacy migration section (lines 709-726) and anywhere project config is created

   Implementation:
   - When dataDirectory is set to a relative path (like ".btca")
   - Check if we're in a git repository (look for .git folder)
   - If yes, check/update .gitignore
   - Log a message about the gitignore update
   ```

2. **Add warning for existing .btca folders**

   ```
   Location: During config load when .btca exists

   Implementation:
   - If .btca/ exists and .gitignore doesn't include it
   - Log a warning with instructions
   - Don't auto-modify in this case (existing behavior preservation)
   ```

##### Phase 4: Documentation and User Guidance

**File:** `apps/cli/src/commands/init.ts`

1. **Add helpful output messages**

   ```
   Success message example:

   Created btca.config.jsonc

   Data directory: .btca/ (local to this project)
   Added .btca/ to .gitignore

   Next steps:
   1. Add resources: btca config resources add -n <name> -t git -u <url>
   2. Ask a question: btca ask -r <resource> -q "your question"

   Run 'btca --help' for more options.
   ```

2. **Add warning for non-git directories**

   ```
   If --local but no .git folder:

   Warning: This directory doesn't appear to be a git repository.
   The .btca/ folder will be created but .gitignore was not updated.
   If you initialize git later, add '.btca/' to your .gitignore.
   ```

---

#### Testing Plan

1. **Unit Tests**
   - Test gitignore helper functions
   - Test pattern detection in various .gitignore formats
   - Test safe appending with proper newlines

2. **Integration Tests**
   - Run `btca init` in empty directory
   - Run `btca init --local` in git repo, verify .gitignore updated
   - Run `btca init` with existing config, verify warning
   - Run `btca init --force` with existing config, verify overwrite

3. **Manual Testing**
   - Full workflow: init, add resource, ask question
   - Verify `git status` doesn't show .btca/
   - Verify no embedded repo warnings on `git add .`

---

#### Files to Modify/Create

| File                                  | Changes                        |
| ------------------------------------- | ------------------------------ |
| `apps/cli/src/commands/init.ts`       | New file - init command        |
| `apps/cli/src/lib/utils/gitignore.ts` | New file - gitignore utilities |
| `apps/cli/src/index.ts`               | Register init command          |
| `apps/server/src/config/index.ts`     | Gitignore warnings/auto-update |

---

#### Acceptance Criteria

- [ ] `btca init` creates project config file
- [ ] `btca init --local` sets up local .btca directory
- [ ] .gitignore is updated when using local data directory in git repo
- [ ] Existing .gitignore entries are preserved
- [ ] Warning shown if .btca exists but not in .gitignore
- [ ] Clear success messages with next steps
- [ ] `--force` flag allows overwriting existing config

---

### Issue #96: Code block scroll on website

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/96

**Problem Statement:**
Code blocks on the btca.dev homepage are truncated horizontally without a scrollbar, forcing users to manually select and drag text to see the full content.

**Current Behavior:**

- Code blocks overflow their container
- No horizontal scrollbar visible
- Content is cut off on the right side

**Affected File:** `apps/web/src/routes/+page.svelte`

---

#### Implementation Plan

##### Phase 1: Identify Affected Elements

**File:** `apps/web/src/routes/+page.svelte`

1. **Audit code block rendering**
   ```
   Investigation:
   - Find all <pre> and <code> elements
   - Check if using a syntax highlighting library (e.g., Prism, Shiki)
   - Identify the CSS classes applied to code blocks
   - Check parent container constraints
   ```

##### Phase 2: CSS Fixes

**File:** `apps/web/src/routes/+page.svelte` or global CSS file

1. **Add overflow handling to code blocks**

   ```css
   /* Option A: Direct element styling */
   pre {
   	overflow-x: auto;
   	max-width: 100%;
   }

   pre code {
   	display: block;
   	overflow-x: auto;
   }

   /* Option B: If using Tailwind */
   /* Add classes: overflow-x-auto max-w-full */
   ```

2. **Ensure proper container constraints**

   ```css
   /* Parent container should constrain width */
   .code-container {
   	max-width: 100%;
   	overflow: hidden;
   }

   /* Code block itself handles scroll */
   .code-container pre {
   	overflow-x: auto;
   	scrollbar-width: thin; /* Firefox */
   }

   /* Webkit scrollbar styling (optional) */
   .code-container pre::-webkit-scrollbar {
   	height: 8px;
   }

   .code-container pre::-webkit-scrollbar-thumb {
   	background-color: rgba(0, 0, 0, 0.2);
   	border-radius: 4px;
   }
   ```

##### Phase 3: Test Across Breakpoints

1. **Responsive testing**

   ```
   Test at:
   - Desktop (1920px, 1440px, 1280px)
   - Tablet (1024px, 768px)
   - Mobile (425px, 375px, 320px)

   Verify:
   - Scrollbar appears when content overflows
   - Scrollbar is usable (not too thin)
   - No horizontal page scroll (only code block scrolls)
   ```

2. **Browser testing**

   ```
   Test in:
   - Chrome/Edge (Chromium)
   - Firefox
   - Safari

   Verify scrollbar styling works or degrades gracefully
   ```

---

#### Files to Modify

| File                               | Changes                 |
| ---------------------------------- | ----------------------- |
| `apps/web/src/routes/+page.svelte` | CSS for code blocks     |
| `apps/web/src/app.css`             | Global styles if needed |

---

#### Acceptance Criteria

- [ ] Code blocks show horizontal scrollbar when content overflows
- [ ] Scrollbar is visible and usable
- [ ] No content is cut off without indication
- [ ] Page doesn't scroll horizontally (only code block)
- [ ] Works across major browsers
- [ ] Responsive across screen sizes

---

## Future Work - Deferred Issues

This section documents issues that are deferred for now but should be addressed in future development cycles.

---

### Issue #109: Model validation for opencode gateway

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/109

**Problem Summary:**
When using `provider: "opencode"` with a model like `claude-haiku-4-5`, btca rejects the model because opencode acts as a gateway/router to other providers, but validation only checks against opencode's native model list.

**Impact:** Medium-High - Blocks users who want to use opencode as a unified gateway

**High-Level Solution:**

1. Detect when provider is a "gateway" provider (like opencode)
2. Either skip model validation entirely for gateway providers
3. Or fetch the full list of routable models from the gateway
4. Update `validateProviderAndModel()` in `apps/server/src/agent/service.ts`

**Estimated Effort:** Small (1-2 hours)

**Key Files:**

- `apps/server/src/agent/service.ts` (lines 166-189)

---

### Issue #105 & #89: Windows Platform Issues

**GitHub Issues:**

- https://github.com/davis7dotsh/better-context/issues/105
- https://github.com/davis7dotsh/better-context/issues/89

**Problem Summary:**

- #105: TUI crashes with "Orphan text error" from OpenTUI on Windows 11
- #89: btca gets stuck at "creating collection..." on Windows 11/PowerShell

Both issues indicate Windows is not a well-supported platform currently.

**Impact:** High - Completely blocks Windows users

**High-Level Solution:**

1. **Investigation Phase:**
   - Set up Windows development environment
   - Reproduce both issues
   - Determine if issues are in OpenTUI, Bun, or btca code

2. **Short-term Mitigations:**
   - Add `--no-tui` flag to bypass TUI entirely
   - Add better error handling and timeout messages
   - Document WSL as recommended approach for Windows

3. **Long-term Fixes:**
   - Work with OpenTUI maintainers if upstream issue
   - Add Windows-specific code paths if needed
   - Consider alternative TUI library with better Windows support

**Estimated Effort:** Large (1-2 weeks for proper Windows support)

**Key Files:**

- `apps/cli/src/tui/` (entire directory)
- `apps/cli/src/commands/tui.ts`
- Potentially OpenTUI library (external)

---

### Issue #91: Sub-agent mode filtering

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/91

**Problem Summary:**
When btca is used as a sub-agent in an agentic workflow, the LLM's reasoning traces and tool calls pollute the primary agent's context, increasing token costs and making outputs harder to parse.

**Impact:** Medium - Important for agentic workflows

**High-Level Solution:**

1. Add CLI flags: `--hide-reasoning`, `--hide-tool-calls`, or `--subagent-mode`
2. Filter stream events before output based on flags
3. Use existing `packages/shared/src/stream-filter.ts` utilities
4. Default: show everything; subagent mode: final answer only

**Estimated Effort:** Medium (4-8 hours)

**Key Files:**

- `apps/cli/src/commands/ask.ts`
- `packages/shared/src/stream-filter.ts`
- `apps/server/src/agent/service.ts` (event handling)

---

### Issue #63: Session resume

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/63

**Problem Summary:**
Users cannot list or resume previous `btca chat` sessions. Each session is ephemeral and lost when the CLI exits.

**Impact:** Medium - Quality of life improvement

**High-Level Solution:**

1. Add session persistence to `~/.local/share/btca/sessions/`
2. Store: session ID, messages, resources, timestamps
3. Add commands: `btca sessions list`, `btca sessions resume <id>`
4. Port schema concepts from web app's Convex implementation

**Estimated Effort:** Medium-Large (8-16 hours)

**Key Files:**

- `apps/cli/src/tui/context/messages-context.tsx`
- `apps/cli/src/commands/` (new sessions command)
- `apps/web/src/convex/threads.ts` (reference implementation)

---

### Issue #108: Input history

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/108

**Problem Summary:**
Users cannot navigate through previous inputs using up/down arrows like standard terminal history.

**Impact:** Low-Medium - Nice UX improvement

**High-Level Solution:**

1. Add history file at `~/.local/share/btca/history.json`
2. Store last N inputs (configurable, default 100)
3. Implement up/down arrow navigation in TUI input component
4. Persist across sessions

**Estimated Effort:** Small-Medium (2-4 hours)

**Key Files:**

- `apps/cli/src/tui/components/` (input component)
- New history utility file

---

### Issue #94, #97, #93: OpenCode Integration Features

**GitHub Issues:**

- https://github.com/davis7dotsh/better-context/issues/94 (btca opencode tool/plugin)
- https://github.com/davis7dotsh/better-context/issues/97 (custom tool configuration)
- https://github.com/davis7dotsh/better-context/issues/93 (external file read allowlist)

**Problem Summary:**
These three issues relate to deeper OpenCode integration:

- #94: Create official btca tool for OpenCode agents
- #97: Allow users to enable/disable custom tools in btca's OpenCode instance
- #93: Allow btca to read files outside the collection (e.g., config files)

**Impact:** Medium - Power user features

**High-Level Solutions:**

**#94 - btca OpenCode tool:**

1. Create tool script template at `.config/opencode/tools/btca.ts`
2. Implement actions: list, ask, add
3. Document integration patterns

**#97 - Custom tool configuration:**

1. Add `opencode.tools` and `opencode.permission` to config schema
2. Merge user config into `buildOpenCodeConfig()`
3. Add CLI flags for ephemeral overrides

**#93 - External file allowlist:**

1. Add `externalReadAllowlist` config option
2. Modify permission handling in agent config
3. Default deny, explicit allowlist for security

**Estimated Effort:** Medium (4-8 hours each)

**Key Files:**

- `apps/server/src/agent/service.ts`
- `apps/server/src/config/index.ts`
- Config schema files

---

## Issue #101: Missing linux-arm64 binary

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/101

**Problem Summary:**
btca fails to run in Alpine Linux ARM64 Docker containers because the `btca-linux-arm64` binary is not included in the distribution.

**Impact:** Medium - Blocks containerized deployments on ARM64

**High-Level Solution:**

1. Update build scripts to include ARM64 Linux target
2. Or: Document that Alpine (musl) is not supported, recommend glibc-based images
3. Or: Provide instructions for building from source in containers

**Estimated Effort:** Small (1-2 hours if just build config)

**Key Files:**

- `package.json` (build scripts)
- Build/release configuration

---

## Issue #90: Windows local file paths

**GitHub Issue:** https://github.com/davis7dotsh/better-context/issues/90

**Problem Summary:**
Local file paths don't work correctly on Windows (e.g., `E:\GitHub\...`).

**Impact:** Medium - Blocks Windows users with local resources

**High-Level Solution:**

1. Normalize paths using `path.normalize()` and `path.resolve()`
2. Handle Windows drive letters and backslashes
3. Test local resource configuration on Windows

**Estimated Effort:** Small-Medium (2-4 hours)

**Key Files:**

- `apps/server/src/config/index.ts`
- `apps/server/src/resources/impls/local.ts`

---

## Implementation Priority Matrix

| Issue                   | Effort | Impact | Priority Score | Status   |
| ----------------------- | ------ | ------ | -------------- | -------- |
| #99 (cleanup)           | Medium | High   | **High**       | DONE     |
| #76 (searchPath)        | Medium | High   | **High**       | PLANNED  |
| #81 (.btca folder)      | Medium | Medium | **Medium**     | PLANNED  |
| #96 (CSS scroll)        | Small  | Low    | **Low**        | PLANNED  |
| #109 (gateway)          | Small  | High   | High           | DEFERRED |
| #105/#89 (Windows)      | Large  | High   | High           | DEFERRED |
| #91 (sub-agent)         | Medium | Medium | Medium         | DEFERRED |
| #63 (sessions)          | Large  | Medium | Medium         | DEFERRED |
| #108 (history)          | Small  | Low    | Low            | DEFERRED |
| #94/97/93 (OC features) | Medium | Medium | Medium         | DEFERRED |

---

## Next Steps

1. Begin implementation of Issue #99 (OpenCode instance cleanup)
2. Follow with Issue #76 (searchPath validation)
3. Then Issue #81 (.btca folder / btca init)
4. Finally Issue #96 (CSS fix - quick win)

Each implementation should include:

- Code changes as specified
- Unit/integration tests
- Documentation updates if needed
- PR with reference to the GitHub issue
