# Services

This repository stays fully open-source. If you want faster deployment, support, or managed operations, use the services path below.

- Contact: `nino.skopac@gmail.com`
- Portfolio: https://www.upwork.com/freelancers/~013469808662f577d0

---

## Secure install (one-time)

Best for teams that want a hardened deployment quickly.

Deliverables:
- profile selection and baseline hardening setup
- deployed OpenClaw stack on Ubuntu 22.04/24.04 with Docker
- DNS allowlist + host firewall configuration aligned to your use case
- verifier run and delivery of `security-report.md`

Pricing:
- **Starter — $499** *(1 host, 1 standard profile)*
- **Team — $1,500** *(1 host, up to 3 profiles, tailored allowlist up to ~15 domains)*
- **Hardened — $3,500** *(policy review + stricter hardening plan + 1 follow-up verification)*

Notes:
- You provide the server (Hetzner/AWS/etc.) and credentials.
- “Strict egress (block direct-to-IP)” is a separate project unless already implemented in your environment.

---

## Managed updates (monthly)

Best for teams that want ongoing maintenance and reduced operational overhead.

Deliverables:
- regular updates of this kit and dependency patches
- change review and rollout plan
- periodic verification reports after updates
- incident response support window definition

Pricing:
- **Maintenance — $299/mo** *(monthly updates, `doctor` report, best-effort support within 48h)*
- **Ops — $799/mo** *(biweekly updates, rollback plan, 24h response, 1 incident/month included)*
- **On-call add-on — +$500/mo** *(8×5 priority support)*

Notes:
- Pricing assumes a single environment. Additional environments: **+50% each**.

---

## Custom profiles / policy tuning

Best for organizations with domain-specific access and compliance requirements.

Deliverables:
- custom profile design (`network.allow`, approvals, hardening policy)
- policy tuning based on workflows and threat tolerance
- validation checklist and report outputs for each tuned profile

Pricing:
- **Profile Pack — $1,500** *(2 custom profiles + validation outputs)*
- **Compliance-ish — $5,000** *(4 profiles + control mapping + operator runbook)*
- **Hourly — $200/hr** *(2h minimum)*

---

## Scope & assumptions

- You provide the server and credentials.
- This is hardening + guardrails, not a guarantee against all abuse.
- Support is limited to the purchased scope and time window.
