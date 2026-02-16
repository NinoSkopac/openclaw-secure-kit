# Installation (Ubuntu)

`install.sh` targets Ubuntu 22.04/24.04 and installs to `/opt/openclaw-secure-kit` by default.

## Clone + install

```bash
git clone https://github.com/NinoSkopac/openclaw-secure-kit
cd openclaw-secure-kit
chmod +x install.sh uninstall.sh
./install.sh
```

## Common installer options

Dry-run (no changes):

```bash
./install.sh --dry-run
```

Skip dependency installation (assumes docker/node/nftables/git already present):

```bash
./install.sh --no-deps
```

Install to a custom prefix:

```bash
./install.sh --prefix /srv/openclaw-secure-kit
```

Replace an existing non-git prefix directory:

```bash
./install.sh --force
```

Show installer source version (git commit if available):

```bash
./install.sh --version
```

## Curl | bash

```bash
curl -fsSL https://raw.githubusercontent.com/NinoSkopac/openclaw-secure-kit/refs/heads/main/install.sh | bash
```

## Uninstall

Remove wrapper only:

```bash
./uninstall.sh
```

Remove wrapper + install prefix + runtime dirs:

```bash
./uninstall.sh --purge
```

Purge a custom prefix:

```bash
./uninstall.sh --purge --prefix /srv/openclaw-secure-kit
```

## Acceptance checks (documented)

Expected commands:

```bash
./install.sh --dry-run
./install.sh --no-deps
./uninstall.sh --purge
```

## Runtime directory behavior

`openclaw-gateway` runs as non-root (`node:node`).
To avoid fresh-install permission issues on bind mounts, runtime directories
`/home/node/.openclaw/canvas` and `/home/node/.openclaw/cron` are mounted as tmpfs overlays (ephemeral).
No extra `chown`, `chmod`, or `sudo docker compose` steps are required.
