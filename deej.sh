#!/bin/bash

# deej.sh - Autonomous migration loop using OpenCode
# Runs until status.md shows "done" or "error"

set -e

STATUS_FILE="status.md"
MIGRATION_PLAN="MIGRATION_PLAN.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to get current status from status.md
get_status() {
    # Extract status from "## Current Status: `running`" format
    # Using sed for macOS compatibility (no -P flag needed)
    grep "Current Status:" "$STATUS_FILE" 2>/dev/null | sed 's/.*`\([^`]*\)`.*/\1/' || echo "unknown"
}

# Function to print with timestamp
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# The prompt that will be sent to OpenCode each iteration
AGENT_PROMPT='You are an autonomous migration agent working on the btca chat-web app.

## Your Mission
You are running in a loop. Each iteration, you must:
1. Read `status.md` to understand current progress
2. Read `MIGRATION_PLAN.md` to see all tasks
3. Pick ONE task that can be completed right now (prefer earlier phases, unblocked tasks)
4. Implement that task fully
5. Verify your work (run checks, fix errors)
6. Update `MIGRATION_PLAN.md` to mark the task as done
7. Update `status.md` with progress notes
8. Exit (the loop will restart you)

## Important Rules
- **ONE TASK PER ITERATION** - Do not try to do everything at once
- **CHECK YOUR WORK** - Run `bun run check:chat-web` and `bun run format:chat-web` after changes
- **USE BTCA** - Run `btca ask -r convexJs -q "..."` or other resources for documentation help
- **LEAVE NOTES** - Update status.md with notes for your next iteration
- **HANDLE ERRORS** - If you hit a blocking issue, set status to `error` and explain in status.md

## Available Resources (via btca)
- `convexJs` - Convex JavaScript SDK docs
- `clerk` - Clerk authentication docs  
- `daytona` - Daytona sandbox SDK docs
- `svelte` - Svelte docs
- `svelteKit` - SvelteKit docs
- `tailwind` - Tailwind CSS docs
- `zod` - Zod validation docs
- `hono` - Hono framework docs

## Commands
- `bun run check:chat-web` - Type check the chat-web app
- `bun run format:chat-web` - Format the chat-web app
- `btca ask -r <resource> -q "<question>"` - Ask documentation questions

## When to Set Status
- `running` - Normal operation, more tasks to do
- `done` - ALL tasks in MIGRATION_PLAN.md are complete
- `error` - Critical issue that needs human help (explain in status.md)

## Current Working Directory
/Users/davis/Developer/better-context

Now read status.md and MIGRATION_PLAN.md, pick your next task, and execute it.'

# Main loop
log "${GREEN}Starting deej migration loop${NC}"
log "Status file: $STATUS_FILE"
log "Migration plan: $MIGRATION_PLAN"

iteration=0

while true; do
    iteration=$((iteration + 1))
    
    log "${YELLOW}=== Iteration $iteration ===${NC}"
    
    # Check current status
    status=$(get_status)
    log "Current status: $status"
    
    # Exit conditions
    if [ "$status" = "done" ]; then
        log "${GREEN}✓ Migration complete! Status is 'done'.${NC}"
        exit 0
    fi
    
    if [ "$status" = "error" ]; then
        log "${RED}✗ Migration halted. Status is 'error'. Check status.md for details.${NC}"
        exit 1
    fi
    
    if [ "$status" = "unknown" ]; then
        log "${RED}✗ Could not read status from status.md${NC}"
        exit 1
    fi
    
    # Run OpenCode with the prompt
    log "Running OpenCode agent..."
    
    # Use opencode with the prompt
    # The agent will read files, make changes, and exit
    opencode run -m openai/gpt-5.2-codex --variant high "$AGENT_PROMPT" 
    
    # Small delay between iterations to avoid hammering
    log "Iteration $iteration complete. Waiting 2 seconds before next iteration..."
    sleep 2
done
