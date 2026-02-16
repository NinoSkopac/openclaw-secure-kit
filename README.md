# openclaw-secure-kit

[![CI](https://img.shields.io/github/actions/workflow/status/NinoSkopac/openclaw-secure-kit/ci.yml?branch=main&label=CI)](https://github.com/NinoSkopac/openclaw-secure-kit/actions/workflows/ci.yml)
![Ubuntu](https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-E95420?logo=ubuntu&logoColor=white)
![Docker required](https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white)

Secure-by-default, profile-driven hardening for running OpenClaw on Ubuntu with verifiable egress controls.

## What you get

- Profile-driven install output under `out/<profile>/` with externalized secrets and pinned image tags.
- DNS allowlist + host firewall controls with loopback-first gateway exposure by default.
- One-command verification (`ocs doctor`) that writes a repeatable `security-report.md` (PASS/WARN/FAIL).

## Quickstart
> **Why `sudo`?** The installer sets up system dependencies and host security controls (nftables/systemd) and installs to `/opt`, which requires root on Ubuntu.
```bash
git clone https://github.com/NinoSkopac/openclaw-secure-kit
cd openclaw-secure-kit
chmod +x install.sh
sudo ./install.sh

ocs install --profile research-only
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env up -d
# Optional when already in out/research-only:
# cd out/research-only && docker compose --env-file .env up -d
sudo ocs doctor --profile research-only
```

`openclaw-gateway` runs as non-root (`node:node`) so OpenClaw can write state without manual permission steps, and uses tmpfs overlays for `/home/node/.openclaw/canvas` and `/home/node/.openclaw/cron`.
Run doctor with `sudo` for reliable host/runtime checks: `sudo ocs doctor --profile research-only --verbose`.
If you are developing from a local checkout, run `node dist/ocs.js ...` from that checkout (or re-run `sudo ./install.sh` to refresh `/opt`). The global `ocs` wrapper now blocks stale `/opt` runs when it detects a different local commit.
For one-off compose commands, use `docker compose --env-file ... run ...` (place `--env-file` before `run`).

## Learn more

- Threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
- Services: [`docs/SERVICES.md`](docs/SERVICES.md)
- Quickstart guide: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)
- Install guide: [`docs/INSTALL.md`](docs/INSTALL.md)

## Who is this for?

- Teams that want OpenClaw access without giving agents full internet egress.
- Organizations running agents for contractors or internal teams that need guardrails by default.
- Operators who need a repeatable security report for internal policy/compliance reviews.

## Verification snapshot

```text
Version: 0.1.0 (9ff1fc3)
Wrote security report to out/research-only/security-report.md
PASS: 18  WARN: 2  FAIL: 0
```

`WARN` includes the known direct-to-IP HTTPS caveat.

## Security model

v1 focuses on:
- domain-level egress control (DNS allowlist + host firewall)
- non-public gateway exposure (loopback by default)
- non-root containers
- secrets externalized (gateway token stays in `.env`, not embedded in compose)
- pinned image tags (no `latest`)

The default tag is pinned intentionally and is bumped only after validation.

Important caveat: direct-to-IP HTTPS may still work (for example, `https://1.1.1.1`) even when non-allowlisted domains are blocked by DNS policy. Do not treat v1 as an impossible-bypass model.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for guarantees, assumptions, limitations, and hardening options.

## Maintainers

Before tagging a release, run [`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md).
