# Quickstart

```bash
git clone https://github.com/NinoSkopac/openclaw-secure-kit
cd openclaw-secure-kit
chmod +x install.sh
./install.sh
ocs install --profile research-only
sudo ocs doctor --profile research-only
cat out/research-only/security-report.md
```

The generated research-only profile is non-interactive by default (no manual `openclaw setup` step required).

If ports `18789/18790` are already in use, `ocs install` auto-selects free ports in `.env`. Check `out/research-only/.env` before connecting clients.

## Direct-to-IP caveat and strict mode

DNS allowlisting controls domain resolution, but it cannot block direct HTTPS connections to raw IPs by itself.
By default (`network.direct_ip_policy: warn`), `ocs doctor` reports direct-to-IP reachability as `WARN`.

To enforce strict behavior for this check, set this in your profile:

```yaml
network:
  direct_ip_policy: fail
```

Or run one-off strict verification from CLI:

```bash
sudo ocs doctor --profile research-only --strict-ip-egress
```

See `docs/HARDENING.md` for hardened egress guidance (coming next).

If doctor reports any `FAIL`, address those findings before treating the host as compliant.
