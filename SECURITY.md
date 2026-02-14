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

- CI runs a secret scanning workflow (`.github/workflows/secret-scan.yml`) on push and pull requests.
- The workflow uses Gitleaks to detect likely committed credentials/tokens before release.
