# btca Design System (v1)

This document defines the btca visual language and UX opinions. It is meant to
be a portable reference for the main btca product and any related surfaces
(docs, app, CLI UIs). It favors clarity, density, and a calm technical feel.

## Brand intent

- **Purpose**: Help users find context fast without friction.
- **Personality**: Precise, calm, engineered, confident.
- **Tone**: Minimal ornamentation; utility-first with deliberate accents.
- **Balance**: Neutrals dominate; color is used sparingly for focus and status.

## Typography

### Primary fonts

- **UI/Body**: Geist
- **Monospace**: Geist Mono

### Font scale (px)

- 12: Overline, micro-labels
- 13: Dense tables, helper text (use sparingly)
- 14: Default body, buttons
- 16: Body, long-form
- 18: Lead paragraphs, section intros
- 20: H3 / card titles
- 24: H2
- 32: H1
- 40: Landing hero (rare)

### Line heights

- Dense UI: 1.25
- Body: 1.45
- Headlines: 1.1–1.2

### Font weights

- Regular 400 for body
- Medium 500 for buttons and UI emphasis
- Semibold 600 for headings

### Typography opinions

- Default to 14/16px body for product UI; 16px for docs.
- Avoid excessive tracking; use natural letter spacing.
- Code blocks should never be smaller than 13px.
- Headings should be compact; do not exceed 2 lines when possible.

## Color system

### Core brand colors

- **Brand / Primary**: `#4783EB`
- **Brand Light**: `#9ABBF4`
- **Brand Dark**: `#1450B8`

### Neutral scale

Use cool neutrals to keep the UI crisp and technical.

- N0: `#FFFFFF`
- N50: `#F7F8FA`
- N100: `#EEF1F5`
- N200: `#DCE3EC`
- N300: `#C7D1DE`
- N400: `#9AA8BC`
- N500: `#72819A`
- N600: `#55667F`
- N700: `#3F5167`
- N800: `#2A394B`
- N900: `#1A2533`

### Semantic colors

Keep semantic colors subtle; they should not compete with the primary brand.

- Success: `#1E7D4F`
- Warning: `#B87416`
- Error: `#B13A3A`
- Info: `#2B6CB0`

### Usage rules

- Neutrals are the base; primary only for emphasis and focus.
- Avoid full-bleed primary backgrounds; use accents and highlights instead.
- Reserve semantic colors for status, not for navigation or primary CTAs.
- Text must meet WCAG AA contrast at minimum.

## Elevation and surfaces

### Elevation tokens

- Elevation 0: Flat
- Elevation 1: `0 1px 2px rgba(0,0,0,0.06)`
- Elevation 2: `0 4px 12px rgba(0,0,0,0.08)`
- Elevation 3: `0 10px 24px rgba(0,0,0,0.12)`

### Surface rules

- Cards use N0 or N50 background.
- Use 1px borders on N200 for structure instead of heavy shadows.
- Modal backdrops use `rgba(10, 18, 28, 0.5)`.

## Spacing and layout

### Spacing scale (px)

Use 4px grid.

- 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80

### Layout rules

- Max content width: 1200px for docs, 1400px for app.
- Primary gutters: 24px desktop, 16px tablet, 12px mobile.
- Vertical rhythm: 24px between major sections.
- Prefer dense layouts; reduce whitespace before adding pagination.

## Border radius

- Radius xs: 4px (chips, tags)
- Radius sm: 6px (buttons, inputs)
- Radius md: 8px (cards)
- Radius lg: 12px (modals)

## Buttons

### Types

- Primary: solid brand
- Secondary: neutral background with brand border
- Ghost: transparent with neutral text
- Destructive: error background

### Button specs

- Height: 32px (dense), 36px (default), 40px (prominent)
- Padding: 12px horizontal, 8px vertical
- Text size: 14px
- Icons: 16px

### Button rules

- One primary per view when possible.
- Disabled state uses N200 background and N500 text.

## Inputs

### Input specs

- Height: 36px
- Border: 1px N300
- Focus: 2px outline in brand color with 20% opacity halo
- Placeholder: N500

### Validation

- Error state: border Error, helper text Error.
- Success: border Success (only if explicitly needed).

## Navigation

### Global nav

- Neutral background, 1px bottom border.
- Active item uses brand underline or brand text only.

### Side nav

- Dense list, 32px row height.
- Collapsible groups with subtle chevron.

## Tables

- Row height: 32px (dense), 40px (default)
- Header background: N50
- Borders: N200
- Zebra striping only if more than 10 rows.

## Code blocks

- Background: N900
- Text: N100
- Accent: Brand Light for highlights (keep subtle)
- Font: Geist Mono, 13–14px
- Line height: 1.5

## Icons

- Use clean, geometric line icons.
- Stroke weight should match 1.5px at 16px size.
- Avoid filled icons except for status indicators.

## Motion

### Durations

- Micro: 100–150ms
- Standard: 200–250ms
- Large: 300–350ms

### Motion rules

- Use fades and small vertical shifts.
- Avoid springy or playful motion.
- Critical actions should never rely on animation to communicate state.

## Accessibility

- Target WCAG AA contrast for all text.
- Focus styles must be visible and consistent.
- Use system cursor and never disable text selection in content.
- Keyboard nav must cover all interactive elements.

## Content and tone

- Prefer direct verbs: “Add resource”, “Link API key”, “Run query”.
- Error messages must include a fix path.
- Avoid marketing language in core UI.

## Component inventory (opinionated)

### Cards

- Use for grouping settings or metrics.
- Title + short description + action.
- Minimal border, no heavy shadow.

### Empty states

- 1-line title, 1-line action.
- Avoid illustration unless it adds meaning.

### Status banners

- Use info/warn/error colors with light background tint.
- Always include dismiss on non-critical banners.

### Badges

- Use N50 background by default.
- Brand badge reserved for “beta” or “new”.

## Theming guidance

- Dark mode is optional; if added, use neutral inversion with reduced saturation.
- Brand color should stay constant between themes to preserve recognition.

## CSS token map (suggested)

```
--btca-brand: #4783EB;
--btca-brand-light: #9ABBF4;
--btca-brand-dark: #1450B8;

--btca-n0: #FFFFFF;
--btca-n50: #F7F8FA;
--btca-n100: #EEF1F5;
--btca-n200: #DCE3EC;
--btca-n300: #C7D1DE;
--btca-n400: #9AA8BC;
--btca-n500: #72819A;
--btca-n600: #55667F;
--btca-n700: #3F5167;
--btca-n800: #2A394B;
--btca-n900: #1A2533;

--btca-success: #1E7D4F;
--btca-warning: #B87416;
--btca-error: #B13A3A;
--btca-info: #2B6CB0;

--btca-radius-xs: 4px;
--btca-radius-sm: 6px;
--btca-radius-md: 8px;
--btca-radius-lg: 12px;
```

## Porting checklist

- Apply fonts (Geist / Geist Mono) across app + docs.
- Align neutral palette and replace any ad-hoc grays.
- Consolidate buttons into Primary / Secondary / Ghost / Destructive.
- Ensure spacing scale is 4px-based everywhere.
- Add consistent focus ring and input states.
- Validate contrast for body and code blocks.
