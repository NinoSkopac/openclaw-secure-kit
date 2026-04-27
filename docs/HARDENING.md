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
  egress_mode: proxy-only
```

Alias (equivalent to setting both `direct_ip_policy: fail` and `egress_mode: proxy-only`):

```yaml
network:
  strict_ip_egress: true
```

You can also force strict mode from CLI for a one-off run:

```bash
sudo ocs doctor --profile research-only --strict-ip-egress
```

## Hardened egress

Use `network.egress_mode` to declare the enforcement model:

```yaml
network:
  egress_mode: dns-allowlist   # default v1 mode
```

For no-bypass posture, switch to proxy-only mode:

```yaml
network:
  egress_mode: proxy-only
```

When `direct_ip_policy: fail` is set, `ocs doctor`/`ocs verify` now require `egress_mode: proxy-only` and will fail otherwise.
