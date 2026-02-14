# openclaw-secure-kit

`openclaw-secure-kit` provides a profile-driven setup for running OpenClaw on Ubuntu 22.04/24.04 with Docker, DNS allowlist controls, host firewall enforcement, and a verifier report (`security-report.md`).
If you want a hardened setup fast, see Services.

## What this is (and isn’t)

This kit is **defense-in-depth hardening** for running OpenClaw safely on a Linux host.
It aims to make “secure-by-default” the easy path and to produce a repeatable verification report.

It is **not** a guarantee that bypass is impossible. See the Security model and Threat model below.

## Security model

v1 focuses on:
- domain-level egress control (DNS allowlist + host firewall)
- non-public gateway exposure (loopback by default)
- non-root containers
- secrets externalized (gateway token stays in `.env`, not embedded in compose)
- pinned image tags (no `latest`)

Important caveat: direct-to-IP HTTPS may still work (for example, `https://1.1.1.1`) even when non-allowlisted domains are blocked by DNS policy. Do not treat v1 as an impossible-bypass model.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for guarantees, assumptions, limitations, and hardening options.

## Quickstart

- Quickstart: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)
- Install: [`docs/INSTALL.md`](docs/INSTALL.md)

## Sample output

Typical `security-report.md` excerpt:

```md
# Security Report

- Profile: `research-only`
- Summary: 6 PASS / 1 WARN / 1 FAIL

## Checks
- PASS: Gateway not public (no 0.0.0.0 binding) — ports are localhost-only.
- PASS: Container runs as non-root — uid=65532
- PASS: Docker socket not mounted — No docker socket mount detected in compose or runtime.
- PASS: DNS forced through dns_allowlist — runtime dns=["172.29.0.53"]
- PASS: Egress blocked to non-allowlisted domains — curl https://example.com blocked as expected
- PASS: Egress works to allowlisted domains — curl https://arxiv.org succeeded
- WARN: Direct-to-IP HTTPS reachable — DNS allowlist blocks domains, but direct-to-IP HTTPS may still work.
- FAIL: Firewall service enabled — disabled
```

## Maintainers

Before tagging a release, run [`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md).
