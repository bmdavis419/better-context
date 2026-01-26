#!/bin/bash

# Effect Rewrite Loop Runner
# Runs cursor agent in a loop until STATUS.md shows completed/blocked
# Usage: ./effect-loop.sh [max_iterations]

set -e

# Configuration
MAX_ITERATIONS="${1:-50}"
ITERATION=0
PROMPT_FILE="PROMPT.md"
STATUS_FILE="STATUS.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if PROMPT.md exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo -e "${RED}Error: $PROMPT_FILE not found${NC}"
    exit 1
fi

# Check if STATUS.md exists
if [ ! -f "$STATUS_FILE" ]; then
    echo -e "${RED}Error: $STATUS_FILE not found${NC}"
    exit 1
fi

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Effect Rewrite Loop Runner${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "Prompt file: ${GREEN}$PROMPT_FILE${NC}"
echo -e "Status file: ${GREEN}$STATUS_FILE${NC}"
echo -e "Max iterations: ${YELLOW}$MAX_ITERATIONS${NC}"
echo ""

# Function to check if goal is accomplished
check_status() {
    if [ ! -f "$STATUS_FILE" ]; then
        echo -e "${RED}Error: $STATUS_FILE not found${NC}"
        return 1
    fi
    
    local status=$(grep -i "^Status:" "$STATUS_FILE" | head -1 | cut -d: -f2- | tr -d ' ' | tr '[:upper:]' '[:lower:]')
    
    if [ "$status" = "completed" ]; then
        echo -e "${GREEN}✓ Status: completed${NC}"
        return 0
    elif [ "$status" = "blocked" ]; then
        echo -e "${YELLOW}⚠ Status: blocked${NC}"
        local reason=$(grep -i "^Reason:" "$STATUS_FILE" | head -1 | cut -d: -f2-)
        if [ -n "$reason" ]; then
            echo -e "${YELLOW}Reason:$reason${NC}"
        fi
        return 0
    fi
    
    return 1
}

# Function to run iteration
run_iteration() {
    local iteration=$1
    
    echo -e "${BLUE}--- Iteration $iteration/$MAX_ITERATIONS ---${NC}"
    echo ""
    
    local prompt=$(cat "$PROMPT_FILE")
    
    echo -e "${BLUE}Running cursor agent...${NC}"
    echo ""
    
    # Run cursor agent
    opencode run -m opencode/gpt-5.2-codex --variant high "$prompt"
    
    echo ""
    
    if check_status; then
        echo -e "${GREEN}✓ Completed after $iteration iterations!${NC}"
        return 0
    fi
    
    return 1
}

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    ITERATION=$((ITERATION + 1))
    
    if run_iteration $ITERATION; then
        echo -e "${GREEN}================================${NC}"
        echo -e "${GREEN}Effect Rewrite Complete!${NC}"
        echo -e "${GREEN}================================${NC}"
        
        echo ""
        echo -e "${BLUE}Final Status:${NC}"
        cat "$STATUS_FILE"
        
        exit 0
    fi
    
    if [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo -e "${YELLOW}================================${NC}"
        echo -e "${YELLOW}Reached max iterations ($MAX_ITERATIONS)${NC}"
        echo -e "${YELLOW}================================${NC}"
        
        echo ""
        echo -e "${BLUE}Current Status:${NC}"
        cat "$STATUS_FILE"
        
        exit 1
    fi
    
    echo -e "${BLUE}Waiting 2 seconds...${NC}"
    echo ""
    sleep 2
done

exit 1
