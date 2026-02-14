# Hardening

## Direct-to-IP behavior

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

## Hardened egress

To actually block direct-to-IP, enable hardened egress mode (proxy-only egress). Detailed hardened egress implementation is coming next.
