# Public Release Go/No-Go Checklist (Questions)

Run from repo root. This is a 15-minute gate: answer each question with commands, then decide go/no-go.

## 1) Are any real secrets committed?
Commands:
```bash
git ls-files > /tmp/ocs-tracked.txt
xargs -a /tmp/ocs-tracked.txt rg -n --glob '!docs/**' --glob '!README.md' '(OPENCLAW_GATEWAY_TOKEN=|TELEGRAM_BOT_TOKEN=|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY)' || true
```
PASS: no output.  
FAIL: any hit in tracked non-doc files.  
Minimal patch: redact and rotate leaked secret, replace with placeholders, and update templates in `src/install-artifacts.ts`, docs in `docs/INSTALL.md`, and add ignores in `.gitignore` if needed.

## 2) Is gateway token externalized (not baked into compose)?
Commands:
```bash
node dist/ocs.js install --profile research-only >/tmp/ocs-install.log
TOKEN=$(grep '^OPENCLAW_GATEWAY_TOKEN=' out/research-only/.env | cut -d= -f2-)
rg -n '\${OPENCLAW_GATEWAY_TOKEN}' out/research-only/docker-compose.yml
rg -nF "$TOKEN" out/research-only/docker-compose.yml || true
```
PASS: interpolation line exists; literal token search returns no lines.  
FAIL: interpolation missing or literal token appears in compose.  
Minimal patch: fix compose env interpolation in `src/install-artifacts.ts`, add/adjust verifier assertion in `src/verifier.ts`.

## 3) Are image tags pinned (no `latest`)?
Commands:
```bash
rg -n '^OPENCLAW_TAG=2026\.2\.13$' out/research-only/.env
rg -n '^OPENCLAW_TAG=latest$|\$\{OPENCLAW_IMAGE\}:latest|image:\s+.*:latest' out/research-only/.env out/research-only/docker-compose.yml src/install-artifacts.ts || true
```
PASS: pinned tag found; no `latest` image/tag usages.  
FAIL: any `latest` usage in generated/runtime files.  
Minimal patch: enforce pinned defaults in `src/constants.ts` and `src/install-artifacts.ts`; update docs in `README.md`.

## 4) Is gateway loopback-only by default?
Commands:
```bash
rg -n '127\.0\.0\.1:\$\{OPENCLAW_GATEWAY_PORT\}:\$\{OPENCLAW_GATEWAY_CONTAINER_PORT\}|127\.0\.0\.1:\$\{OPENCLAW_BRIDGE_HOST_PORT\}:\$\{OPENCLAW_BRIDGE_CONTAINER_PORT\}' out/research-only/docker-compose.yml
rg -n '0\.0\.0\.0:' out/research-only/docker-compose.yml || true
```
PASS: localhost bindings exist; no `0.0.0.0` bindings for default profile.  
FAIL: missing localhost bindings or public bind present by default.  
Minimal patch: correct bind logic in `src/install-artifacts.ts`, validate in `src/verifier.ts`, document in `docs/QUICKSTART.md`.

## 5) Is Docker socket mount absent?
Commands:
```bash
rg -n '/var/run/docker\.sock' out/research-only/docker-compose.yml src || true
```
PASS: no output.  
FAIL: any socket mount found.  
Minimal patch: remove mount from compose generation in `src/install-artifacts.ts`, keep failing check in `src/verifier.ts`.

## 6) Do containers run as non-root?
Commands:
```bash
rg -n 'user:\s+65532:65532' out/research-only/docker-compose.yml
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env up -d
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env exec -T openclaw-gateway id -u
```
PASS: compose has `user: 65532:65532`; runtime uid is not `0`.  
FAIL: missing user setting or runtime uid `0`.  
Minimal patch: set service `user` in `src/install-artifacts.ts`; keep verification in `src/verifier.ts`.

## 7) Does compose render cleanly for newcomers?
Commands:
```bash
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env config >/tmp/ocs-compose.rendered.yml
```
PASS: command exits `0`.  
FAIL: parse/substitution errors.  
Minimal patch: fix `.env` key set and compose interpolation in `src/install-artifacts.ts`; add targeted test in `test/*.test.js`.

## 8) Does gateway stay up (no missing-config crashloop)?
Commands:
```bash
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env ps
docker compose -f out/research-only/docker-compose.yml --env-file out/research-only/.env logs --tail=60 openclaw-gateway
```
PASS: gateway status is `Up` (not restarting), logs do not repeat `Missing config`.  
FAIL: restart loop or missing-config message.  
Minimal patch: ensure non-interactive boot flags/config in `src/install-artifacts.ts`; keep diagnosis path in `src/verifier.ts`.

## 9) Does one-command doctor return a clean verdict?
Commands:
```bash
sudo "$(command -v node)" dist/ocs.js doctor --profile research-only
echo $?
```
PASS: summary shows `FAIL: 0`; exit code is `0`.  
FAIL: any `FAIL > 0` or non-zero exit without report evidence.  
Minimal patch: align summary/report/exit in `src/doctor.ts` + `src/commands.ts`; update tests in `test/doctor-summary.test.js`.

## 10) Is direct-to-IP limitation documented and policy-controlled?
Commands:
```bash
rg -n 'direct-to-IP HTTPS may still work|direct_ip_policy: warn|proxy-only egress' README.md docs/THREAT_MODEL.md docs/HARDENING.md docs/QUICKSTART.md
```
PASS: all concepts are documented and discoverable.  
FAIL: caveat/policy absent or contradictory wording.  
Minimal patch: update wording in `README.md`, `docs/THREAT_MODEL.md`, `docs/HARDENING.md`, `docs/QUICKSTART.md`.

## 11) Is strict direct-IP policy enforceable when requested?
Commands:
```bash
sudo "$(command -v node)" dist/ocs.js doctor --profile research-only --strict-ip-egress || true
rg -n 'Direct-to-IP HTTPS reachable' out/research-only/security-report.md
```
PASS: if direct-to-IP succeeds, check is `FAIL` under strict mode; default mode remains WARN-only.  
FAIL: strict mode still reports only WARN on direct-to-IP reachability.  
Minimal patch: wire policy severity in `src/verifier.ts`, CLI flags in `src/commands.ts`, docs in `docs/HARDENING.md`.

## 12) Are legacy extra profile keys ignored (non-breaking)?
Commands:
```bash
node -e "const {ProfileSchema}=require('./dist/profile-schema.js'); const p=ProfileSchema.parse({openclaw:{approvals:{exec:'require'}},legacy_block:{enabled:true}}); console.log(Object.hasOwn(p,'legacy_block'));"
```
PASS: prints `false` (unknown key stripped).  
FAIL: parser throws or prints `true`.  
Minimal patch: keep root schema stripping in `src/profile-schema.ts`; add/adjust regression in `test/profile-schema.test.js`.

## 13) Is dependency install reproducible from lockfile?
Commands:
```bash
test -f package-lock.json
npm ci
```
PASS: lockfile exists and `npm ci` exits `0`.  
FAIL: missing lockfile or install inconsistency.  
Minimal patch: regenerate and commit `package-lock.json`, reconcile `package.json`, update `docs/INSTALL.md`.

## 14) Is CI checking build/test and secret scanning?
Commands:
```bash
ls .github/workflows
rg -n 'name:\s+CI|npm ci|npm run build|npm test' .github/workflows/*.yml
rg -n 'gitleaks|secret' .github/workflows/*.yml
```
PASS: CI workflow covers install/build/test and a secret-scan workflow exists.  
FAIL: missing build/test or missing secret scan.  
Minimal patch: update `.github/workflows/ci.yml`; add `.github/workflows/secret-scan.yml`.

## 15) Are disclosure and release-gate docs discoverable?
Commands:
```bash
test -f SECURITY.md
test -f docs/PUBLIC_RELEASE_CHECKLIST.md
rg -n 'PUBLIC_RELEASE_CHECKLIST|secure-by-default|loopback|token externalized|pinned' README.md
```
PASS: both docs exist and README links/checklist summary are present.  
FAIL: missing file or missing README link/claims.  
Minimal patch: update `README.md`, `SECURITY.md`, and `docs/PUBLIC_RELEASE_CHECKLIST.md`.
