# Quickstart

```bash
git clone https://github.com/NinoSkopac/openclaw-secure-kit
cd openclaw-secure-kit
chmod +x install.sh
./install.sh
ocs install --profile research-only
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env up -d
# Optional when already in out/research-only:
# cd out/research-only && docker compose --env-file .env up -d
sudo ocs doctor --profile research-only
cat out/research-only/security-report.md
```

Runtime tmpfs/writable check:

```bash
cd out/research-only
CID="$(docker compose --env-file .env ps -q openclaw-gateway)"
docker inspect "$CID" --format '{{json .HostConfig.Tmpfs}}' | jq .
docker compose --env-file .env exec openclaw-gateway sh -lc 'touch /home/node/.openclaw/canvas/_ok && touch /home/node/.openclaw/cron/_ok'
```

The generated research-only profile is non-interactive by default (no manual `openclaw setup` step required).
Containers run as non-root (`65532:65532`), and runtime dirs `/home/node/.openclaw/canvas` and `/home/node/.openclaw/cron` use tmpfs overlays to avoid bind-mount permission issues on fresh installs.
Run doctor with `sudo` for reliable host/runtime checks.
If you run from source instead of the wrapper, use: `sudo node dist/ocs.js doctor --profile research-only --verbose`.

If ports `18789/18790` are already in use, `ocs install` auto-selects free ports in `.env`. Check `out/research-only/.env` before connecting clients.

tmpfs mounts for `canvas` and `cron` do not appear under `docker inspect ... .Mounts`.
Inspect `HostConfig.Tmpfs` instead (for example: `docker inspect <cid> | rg HostConfig.Tmpfs`),
or run `mount` inside the container to confirm runtime tmpfs entries.

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
