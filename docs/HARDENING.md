# Hardening

## Default direct-to-IP behavior

`openclaw-secure-kit` v1 uses DNS allowlisting plus host firewall controls. This blocks disallowed domains, but DNS controls alone cannot stop direct HTTPS requests to raw IP addresses (for example, `https://1.1.1.1`).

## Verification policy

Use `network.direct_ip_policy` in profile YAML:

```yaml
network:
  direct_ip_policy: warn   # default
```

Set strict mode when you want direct-to-IP reachability to fail verification:

```yaml
network:
  direct_ip_policy: fail
```

Alias (equivalent):

```yaml
network:
  strict_ip_egress: true
```

You can also force strict mode from CLI for a one-off run:

```bash
sudo ocs doctor --profile research-only --strict-ip-egress
```

## Hardened egress (proxy-only mode)

Set this in your profile:

```yaml
network:
  hardened_egress_mode: proxy-only
```

Then regenerate/apply and verify:

```bash
ocs install --profile research-only
sudo ocs apply-firewall --profile research-only
sudo ocs doctor --profile research-only --strict-ip-egress
```

How enforcement works:

- `egress-proxy` service is added to compose with generated policy (`egress-proxy.js`) derived from `network.allow` + `network.allow_ports`.
- Runtime services are wired with `HTTP_PROXY`/`HTTPS_PROXY` to `http://egress-proxy:3128`.
- Firewall denies direct outbound from workload containers and only permits egress through the proxy path.
