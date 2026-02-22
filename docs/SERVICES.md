# Services

This repository is fully open-source. If you want faster deployment, support, or managed operations, use the services path below.

Contact info can be found on my profile.

## At a glance

- **Secure install (one-time)**: starts at **$499**
- **Managed updates (monthly)**: starts at **$299/mo**
- **Custom profiles and policy tuning**: starts at **$1,500**

---

## Secure install (one-time)

Best for teams that want a hardened OpenClaw deployment quickly.

Deliverables:
- profile selection and baseline hardening setup
- deployed OpenClaw stack on Ubuntu 22.04/24.04 with Docker
- DNS allowlist plus host firewall configuration aligned to your use case
- verifier run and delivery of `security-report.md`

Packages:
- **Starter - $499**: 1 host, 1 standard profile
- **Team - $1,500**: 1 host, up to 3 profiles, tailored allowlist up to about 15 domains
- **Hardened - $3,500**: policy review, stricter hardening plan, and 1 follow-up verification

Notes:
- you provide the server (Hetzner, AWS, etc.) and credentials
- strict egress (blocking direct-to-IP) is a separate project unless already implemented in your environment

---

## Managed updates (monthly)

Best for teams that want ongoing maintenance and reduced operational overhead.

Deliverables:
- regular updates of this kit and dependency patches
- change review and rollout planning
- periodic verification reports after updates
- incident response support window definition

Packages:
- **Maintenance - $299/mo**: monthly updates, `doctor` report, best-effort support within 48h
- **Ops - $799/mo**: biweekly updates, rollback plan, 24h response, 1 incident/month included
- **On-call add-on - +$500/mo**: 8x5 priority support

Notes:
- pricing assumes a single environment
- each additional environment is **+50%**

---

## Custom profiles and policy tuning

Best for organizations with domain-specific access and compliance requirements.

Deliverables:
- custom profile design (`network.allow`, approvals, hardening policy)
- policy tuning based on workflows and risk tolerance
- validation checklist and report outputs for each tuned profile

Packages:
- **Profile Pack - $1,500**: 2 custom profiles and validation outputs
- **Compliance-ish - $5,000**: 4 profiles, control mapping, operator runbook
- **Hourly - $200/hr**: 2-hour minimum

---

## Engagement workflow

1. **Intake**: you share host details, use case, and required allowlist domains.
2. **Implementation**: profiles are deployed or tuned and `out/<profile>/` artifacts are produced.
3. **Verification**: `ocs doctor` is run and `security-report.md` is reviewed with you.
4. **Handoff or managed ops**: one-time delivery or monthly maintenance.

## What paid scope includes

- profile-driven deployment generation under `out/<profile>/`
- Docker Compose launch support on Ubuntu 22.04/24.04
- DNS allowlist plus host firewall policy alignment
- verifier run (`ocs doctor`) and report handoff
- loopback-first gateway exposure and non-root runtime defaults in generated artifacts

## Scope and assumptions

- you provide the server and credentials
- this is hardening plus guardrails, not a guarantee against all abuse
- support is limited to purchased scope and support window
