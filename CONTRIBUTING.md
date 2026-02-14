# Contributing

## Development Setup

From repo root:

```bash
npm ci
npm run build
npm test
```

## E2E on Ubuntu

E2E is intended for Ubuntu 22.04/24.04 with Docker and sudo:

```bash
make e2e
```

Keep the stack running after the script exits:

```bash
KEEP_RUNNING=1 make e2e
```

## Coding Style

- TypeScript: strict, explicit changes, small focused functions.
- Shell scripts: `bash`, `set -euo pipefail`, idempotent operations where possible.
- Keep docs aligned with actual behavior; avoid claims stronger than what tests verify.
- Prefer readable, maintainable code over clever shortcuts.

## Before Opening a PR

Run:

```bash
make release-check
```

PRs should include:

- clear summary of behavior changes
- validation commands and outputs
- any security impact notes if applicable
