# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch first. If you are running a fork or older snapshot, reproduce on current `main` before reporting.

## Reporting a Vulnerability

Please do not open a public issue for unpatched security vulnerabilities.

Use this process:

1. Open a private security report through your hosting platform's private disclosure feature (or equivalent private contact path).
2. Include a clear description, impact, affected version/commit, and reproduction steps.
3. Include proof-of-concept details only as needed to validate impact.

## Response Expectations

- We will acknowledge receipt as soon as possible.
- We will triage severity and determine remediation priority.
- We will publish a fix and advisory after validation and coordinated disclosure.

## Automated Security Checks

- CI runs Gitleaks as part of `.github/workflows/ci.yml` on pull requests and pushes to `main`.
- Gitleaks findings fail CI.
- Contributors must not commit real credentials, tokens, private keys, or `.env` secrets.
