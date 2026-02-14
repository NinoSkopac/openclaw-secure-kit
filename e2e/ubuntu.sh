#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "package.json" ]]; then
  echo "This script must be run from the repository root." >&2
  exit 1
fi

if [[ ! -f "profiles/research-only.yaml" ]]; then
  echo "Expected profile file missing: profiles/research-only.yaml" >&2
  exit 1
fi

if [[ -r "/etc/os-release" ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "Unsupported OS: expected Ubuntu, got '${ID:-unknown}'." >&2
    exit 1
  fi
  if [[ "${VERSION_ID:-}" != "22.04" && "${VERSION_ID:-}" != "24.04" ]]; then
    echo "Unsupported Ubuntu version: expected 22.04 or 24.04, got '${VERSION_ID:-unknown}'." >&2
    exit 1
  fi
fi

for required in npm node docker sudo; do
  if ! command -v "${required}" >/dev/null 2>&1; then
    echo "Missing required command: ${required}" >&2
    exit 1
  fi
done

ROOT_DIR="$(pwd)"
OUT_DIR="${ROOT_DIR}/out/research-only"
REPORT_PATH="${OUT_DIR}/security-report.md"
COMPOSE_UP=0

cleanup() {
  local exit_code=$?

  if [[ "${KEEP_RUNNING:-0}" != "1" && "${COMPOSE_UP}" -eq 1 ]]; then
    echo "Tearing down docker compose stack (set KEEP_RUNNING=1 to keep it running)..."
    (
      cd "${OUT_DIR}" && docker compose down
    ) || true
  fi

  if [[ "${KEEP_RUNNING:-0}" == "1" && "${COMPOSE_UP}" -eq 1 ]]; then
    echo "KEEP_RUNNING=1 set; leaving docker compose stack running."
  fi

  exit "${exit_code}"
}
trap cleanup EXIT

echo "Installing dependencies with npm ci..."
npm ci

echo "Building project..."
npm run build

echo "Generating install artifacts for research-only profile..."
node dist/ocs.js install --profile research-only

cd "${OUT_DIR}"

echo "Starting docker compose stack..."
docker compose up -d
COMPOSE_UP=1

echo "Applying host firewall..."
(
  cd "${ROOT_DIR}"
  sudo node dist/ocs.js apply-firewall --profile research-only
)

echo "Running verification..."
set +e
(
  cd "${ROOT_DIR}"
  sudo node dist/ocs.js verify --profile research-only --output "${REPORT_PATH}"
)
VERIFY_EXIT_CODE=$?
set -e

echo "Security report:"
if [[ -f "${REPORT_PATH}" ]]; then
  cat "${REPORT_PATH}"
else
  echo "Report not found at ${REPORT_PATH}" >&2
fi

if [[ "${VERIFY_EXIT_CODE}" -ne 0 ]]; then
  echo "E2E verification failed." >&2
  exit "${VERIFY_EXIT_CODE}"
fi

echo "E2E verification passed."
