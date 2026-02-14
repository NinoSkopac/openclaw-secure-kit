# Security Report

- Profile: `research-only`
- Compose: `/home/ubuntu/openclaw-secure-kit/out/research-only/docker-compose.yml`
- Generated: 2026-02-13T20:41:49.412Z
- Summary: 7 PASS / 0 FAIL

## Checks
- PASS: OpenClaw UI not public (no 0.0.0.0 binding) — No ports published on openclaw service.
- PASS: Container runs as non-root — uid=65532
- PASS: Docker socket not mounted — No docker socket mount detected in compose or runtime.
- PASS: DNS forced through dns_allowlist — runtime dns=["172.29.0.53"]
- PASS: Egress blocked to non-allowlisted domains — curl https://example.com blocked as expected (% Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
                                 Dload  Upload  Total   Spent   Left   Speed
  0      0   0      0   0      0      0      0                              0curl: (6) Could not resolve host: example.com (DNS server returned general failure))
- PASS: Egress works to allowlisted domains — curl https://arxiv.org succeeded
- PASS: Firewall service enabled — systemctl is-enabled returned 'enabled'
