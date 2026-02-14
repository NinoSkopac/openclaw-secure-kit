# openclaw-secure-kit

`openclaw-secure-kit` provides a profile-driven setup for running OpenClaw on Ubuntu 22.04/24.04 with Docker, DNS allowlist controls, host firewall enforcement, and a verifier report.
If you want a hardened setup fast, see Services.

## Security model

v1 focuses on domain-level egress control (DNS allowlist + host firewall), non-public OpenClaw UI exposure, and non-root containers.

Important caveat: direct-to-IP HTTPS may still work (for example, `https://1.1.1.1`) even when non-allowlisted domains are blocked by DNS policy. Do not treat v1 as an impossible-bypass model.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for guarantees, assumptions, limitations, and hardening options.

## Public Release Checklist

Before making the repo public, run [`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md).

- Secure-by-default baseline is required.
- Gateway/bridge bind to loopback by default.
- Gateway token remains externalized in `.env` (not embedded in compose).
- Image tags are pinned (no `latest`).
- Known limitation: direct-to-IP HTTPS may still work and should remain a `WARN` in default mode.

## Sample output

Typical `security-report.md` excerpt:

```md
# Security Report

- Profile: `research-only`
- Summary: 6 PASS / 1 WARN / 1 FAIL

## Checks
- PASS: OpenClaw UI not public (no 0.0.0.0 binding) — No ports published on openclaw service.
- PASS: Container runs as non-root — uid=65532
- PASS: Docker socket not mounted — No docker socket mount detected in compose or runtime.
- PASS: DNS forced through dns_allowlist — runtime dns=["172.29.0.53"]
- PASS: Egress blocked to non-allowlisted domains — curl https://example.com blocked as expected
- PASS: Egress works to allowlisted domains — curl https://arxiv.org succeeded
- WARN: Direct-to-IP HTTPS reachable — DNS allowlist blocks domains, but direct-to-IP HTTPS may still work.
- FAIL: Firewall service enabled — disabled
```

## Docs

- Install: [`docs/INSTALL.md`](docs/INSTALL.md)
- Quickstart: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)
- Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Get help / Services

For installation support, managed updates, and custom policy work, see [`docs/SERVICES.md`](docs/SERVICES.md).
