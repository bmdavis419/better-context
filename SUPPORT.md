# Support and Triage Policy

This document explains how btca issues are prioritized and what maintainers need in order to resolve reports quickly.

## Priorities

1. P0: security bugs, data loss, or complete service outage
2. P1: broken core workflows (`btca ask`, resource add/load, auth)
3. P2: degraded UX or edge-case correctness issues
4. P3: feature requests and polish

## Expected Response Targets

1. P0/P1: initial triage within 72 hours
2. P2/P3: initial triage as capacity allows

These are best-effort targets, not strict SLAs.

## What To Include in Bug Reports

1. Exact btca version (`btca --version`)
2. Runtime and OS (Bun version, platform, shell/terminal)
3. Full command you ran
4. Full error output and stack trace (if present)
5. Minimal reproducible config/resource example

## Duplicate and Related Issues

Maintainers may close issues as duplicates and link to a canonical tracking issue. This helps keep investigation and status updates in one place.

## Support Scope

1. Local CLI and server behavior
2. Cloud/sandbox integration behavior
3. Documentation and migration guidance

## Out of Scope for Immediate Triage

1. Unreproducible reports with no logs
2. Provider-side incidents with no btca regression
3. Product strategy requests without implementation details
