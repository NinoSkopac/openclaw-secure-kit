# openclaw-secure-kit Agent Rules

## Goal
Build `openclaw-secure-kit` for Ubuntu 22.04/24.04 with Docker support.

## v1 Deliverables
- `ocs` CLI implemented in TypeScript
- Profile YAMLs
- Docker Compose generator
- `nftables` enforcement
- Verifier report

## Non-Goals (v1)
- Hetzner provisioning
- Multi-tenant control plane
- Web UI

## Execution Rule
Do exactly ONE ticket at a time. After completing the ticket, STOP and ask the user for the next ticket. Do not proceed automatically.

## Validation Rule
Every ticket must include at least one command the user can run to verify success.
