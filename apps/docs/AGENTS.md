# AGENTS.md

## Project basics
- This is a Mintlify docs site for `btca` (always lowercase).
- Primary brand color: `#255099` (accent only; keep neutrals dominant).
- Logo in `logo/light.svg` and `logo/dark.svg` is the cable icon; favicon in `favicon.svg`.
- Typography: Geist for all UI/body text, Geist Mono for code.

## Required commands
- Always run `mint validate` until it passes after config changes.
- Always run `bun run format` and `bun run check` after edits.

## Package manager
- Use `bun` only. Never use npm, yarn, or pnpm.

## Known gotchas
- `docs.json` does NOT accept `colors.background`; Mintlify validation fails if added.
- Custom CSS lives in `style.css` (currently used for Geist Mono).

## General style
- Prefer functional patterns; avoid explicit return types unless necessary.
- Keep changes concise and aligned with the brand direction above.
