# Security Report

- Profile: `research-only`
- Compose: `/home/ubuntu/openclaw-secure-kit/out/research-only/docker-compose.yml`
- Generated: 2026-02-19T16:00:12.341Z
- Summary: 11 PASS / 1 WARN / 0 FAIL

## Checks
- PASS: Gateway token is not default placeholder — OPENCLAW_GATEWAY_TOKEN is set (length=48).
- PASS: Compose keeps gateway token externalized — docker-compose.yml uses ${OPENCLAW_GATEWAY_TOKEN} and does not contain the literal token.
- PASS: Gateway/bridge ports exposure matches profile — public_listen=false and ports are localhost-only: 127.0.0.1:${OPENCLAW_GATEWAY_PORT}:${OPENCLAW_GATEWAY_CONTAINER_PORT}, 127.0.0.1:${OPENCLAW_BRIDGE_HOST_PORT}:${OPENCLAW_BRIDGE_CONTAINER_PORT}
- PASS: Gateway runtime tmpfs active (HostConfig.Tmpfs) — /home/node/.openclaw/canvas, /home/node/.openclaw/cron present in HostConfig.Tmpfs
- PASS: Container runs as non-root — uid=1000 gid=1000 (non-root)
- PASS: OpenClaw state directory writable — /home/node/.openclaw is writable by runtime user.
- PASS: Docker socket not mounted — No docker socket mount detected in compose or runtime.
- PASS: DNS forced through dns_allowlist — runtime dns=["172.29.0.53"]
- PASS: Egress blocked to non-allowlisted domains — curl https://example.com blocked as expected (% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0curl: (6) Could not resolve host: example.com)
- PASS: Egress works to allowlisted domains — curl https://arxiv.org succeeded
- WARN: Direct-to-IP HTTPS reachable — DNS allowlist blocks domains, but direct-to-IP HTTPS may still work. For stronger enforcement, tighten outbound 443 to an IP allowlist or force all egress through a proxy/egress gateway. To actually block direct-to-IP, enable hardened egress mode (proxy-only egress). Policy=warn. Method=openclaw-gateway curl to https://1.1.1.1 succeeded.
- PASS: Firewall service enabled — systemctl is-enabled returned 'enabled'
