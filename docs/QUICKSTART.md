# Quickstart

```bash
git clone <REPO_URL> openclaw-secure-kit
cd openclaw-secure-kit
chmod +x install.sh
./install.sh
ocs install --profile research-only
sudo ocs doctor --profile research-only
cat out/research-only/security-report.md
```

The generated research-only profile is non-interactive by default (no manual `openclaw setup` step required).

If ports `18789/18790` are already in use, `ocs install` auto-selects free ports in `.env`. Check `out/research-only/.env` before connecting clients.

If doctor reports any `FAIL`, address those findings before treating the host as compliant.
