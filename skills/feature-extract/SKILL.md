---
name: feature-extract
description: Extract complete feature implementations from open-source repositories. Use when you need to understand how a feature works in a production app, learn patterns from excellent codebases, or get reference implementations for building similar features. Do NOT use for general code search or documentation lookup - use btca directly for that.
---

# Feature Extract

Extract working feature implementations from reference repositories to use as blueprints for your own projects.

## When to Use

<guidelines>
    <guideline>
        Use when building a feature similar to one in an open-source project
    </guideline>
    <guideline>
        Use when learning patterns from production-grade codebases
    </guideline>
    <guideline>
        Use when you need complete implementation context (UI + logic + types + tests)
    </guideline>
    <guideline>
        Use when you want to understand how features integrate, not just API docs
    </guideline>
    <guideline>
        Do NOT use for simple code search - use btca grep/glob directly
    </guideline>
    <guideline>
        Do NOT use for documentation lookup - use Context7 or read docs directly
    </guideline>
</guidelines>

## Workflow

<workflow>
    <step name="clone">
        Clone the reference repository to ~/.btca/agent/sandbox if not already present
    </step>
    <step name="search">
        Search for feature-related files using:
        - Keywords (e.g., "dark mode", "theme", "useTheme")
        - File patterns (e.g., *theme*.tsx, *dark*.ts)
        - Import analysis (what files import theme-related modules)
    </step>
    <step name="analyze">
        Identify complete feature boundaries:
        - Core implementation files
        - Type definitions
        - Test files
        - Utility functions
        - Dependencies (what imports what)
    </step>
    <step name="extract">
        Build minimal complete context:
        - Include all files needed to understand the feature
        - Exclude unrelated code
        - Preserve imports and structure
        - Add explanatory comments
    </step>
    <step name="format">
        Format as markdown documentation with:
        - Feature summary and architecture
        - File contents with explanations
        - Key patterns identified
        - Adaptation guidance
    </step>
</workflow>

## Usage

### Basic Command

```
feature-extract --from <repo-url> --feature <feature-name>
```

### Examples

```bash
# Extract dark mode system
feature-extract --from https://github.com/shadcn-ui/ui --feature "dark mode"

# Extract navigation patterns
feature-extract --from https://github.com/calcom/cal.com --feature "navigation"

# Extract hero section with tests
feature-extract --from https://github.com/shadcn/taxonomy --feature "hero section" --include-tests
```

### Options

- `--from, -f`: Repository URL (required)
- `--feature, -t`: Feature name to extract (required)
- `--output, -o`: Output format: context|files|summary (default: context)
- `--depth, -d`: Extraction depth: minimal|complete|full (default: complete)
- `--include-tests`: Include test files (default: true)
- `--include-types`: Include type definitions (default: true)
- `--max-files, -m`: Maximum files to include (default: 20)

## Output Format

```markdown
# Feature: [Name]

**Source**: [Repo URL]
**Files**: [N] files

## Summary
**Purpose**: What this feature does
**Architecture**: How it's structured
**Key Patterns**: Important patterns used

## Files

### [path/to/file.tsx] ([role])
**Description**: What this file does

```typescript
[file content]
```

## Dependencies
- [package-name]: [purpose]

## Adaptation Notes
How to use this in your project...
```

## Best Practices

<guidelines>
    <guideline>
        Be specific with feature names ("dark mode" not "theming system")
    </guideline>
    <guideline>
        Always include test files to understand usage patterns
    </guideline>
    <guideline>
        Follow import chains to find all related files
    </guideline>
    <guideline>
        Include only what's needed - exclude unrelated code
    </guideline>
    <guideline>
        Use as reference for adaptation, not exact copy-paste
    </guideline>
</guidelines>

## Common Features

- **UI Components**: Buttons, modals, forms, navigation, cards
- **State Management**: Stores, contexts, custom hooks
- **Animations**: Transitions, scroll effects, interactions
- **Data Handling**: Fetching, caching, synchronization
- **Authentication**: Login flows, session management
- **Layout**: Dashboards, sidebars, responsive grids
- **Forms**: Validation, submission, error handling

## Integration with btca

This skill uses btca for repository operations:
- `btca add <repo>` - Clone repository
- `btca grep <repo> <keyword>` - Search content
- `btca glob <repo> <pattern>` - Find files
- `btca read <repo> <file>` - Read files
- `btca list <repo> <dir>` - List directories

## Error Handling

<guidelines>
    <guideline>
        If feature not found: Try different keywords or check if repo has the feature
    </guideline>
    <guideline>
        If too many files: Be more specific with feature name or use --max-files
    </guideline>
    <guideline>
        If circular dependencies: Include both files and note the interdependency
    </guideline>
</guidelines>

## References

See `references/examples.md` for example extractions and `references/patterns.md` for common patterns.
