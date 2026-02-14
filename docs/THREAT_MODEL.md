# Threat Model (v1)

## What v1 guarantees

- Domain-level egress control through DNS allowlist policy plus host firewall controls.
- OpenClaw UI is not publicly exposed by default (no broad public bind).
- OpenClaw container runs as a non-root user.

## What v1 does NOT guarantee

- v1 does not guarantee impossible-bypass outbound control.
- Direct-to-IP HTTPS on port 443 may still work in some paths (example: `https://1.1.1.1`).
- Therefore, do not claim that bypass is impossible in v1.

## Assumptions

- End-users do not have SSH access to the host.
- Workloads do not mount the Docker socket.
- Deployment target is Ubuntu 22.04/24.04 with Docker.

## How to harden further (v2)

1. Force all egress through an egress proxy (for example HTTP CONNECT/SNI-aware filtering) and block direct outbound flows.
2. Apply outbound IP allowlists with maintained destination sets aligned to approved services.
3. Use a dedicated egress gateway or service-mesh pattern to centralize and enforce outbound policy.
