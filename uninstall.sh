#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[ocs-install]"
DEFAULT_PREFIX="/opt/openclaw-secure-kit"
WRAPPER_PATH="/usr/local/bin/ocs"
CONFIG_DIR="/etc/openclaw-secure"
STATE_DIR="/var/lib/openclaw-secure"

INSTALL_DIR="${DEFAULT_PREFIX}"
PURGE=0
DRY_RUN=0
DOWN=1
SUDO=""
CURRENT_STEP="startup"

log() {
  echo "${LOG_PREFIX} $*"
}

die() {
  log "ERROR: $*"
  exit 1
}

on_error() {
  local exit_code=$?
  log "FAIL: ${CURRENT_STEP}"
  exit "${exit_code}"
}

trap on_error ERR

format_cmd() {
  local out=()
  for arg in "$@"; do
    out+=("$(printf "%q" "${arg}")")
  done
  printf "%s" "${out[*]}"
}

run_root_cmd() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    if [[ -n "${SUDO}" ]]; then
      log "[dry-run] sudo $(format_cmd "$@")"
    else
      log "[dry-run] $(format_cmd "$@")"
    fi
    return 0
  fi

  if [[ -n "${SUDO}" ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

run_step() {
  CURRENT_STEP="$1"
  shift
  log "STEP: ${CURRENT_STEP}"
  "$@"
  log "OK: ${CURRENT_STEP}"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

get_source_commit() {
  git -C "${SCRIPT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

usage() {
  cat <<EOF
Usage: ./uninstall.sh [options]

Options:
  --no-down          Skip docker compose teardown for generated out/<profile> stacks.
  --purge            Remove install prefix and runtime directories in addition to wrapper.
  --dry-run          Print planned actions without making changes.
  --prefix <dir>     Installation prefix to purge (default: ${DEFAULT_PREFIX}).
  --version          Print source git commit (or 'unknown') and exit.
  -h, --help         Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    --no-down)
      DOWN=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --prefix)
      [[ $# -ge 2 ]] || die "--prefix requires a directory path"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --version)
      get_source_commit
      exit 0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      die "Unknown argument: $1"
      ;;
  esac
done

if [[ "${DRY_RUN}" -eq 0 && "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required to run uninstall."
  log "Validating sudo access..."
  sudo -v
  SUDO="sudo"
elif [[ "${DRY_RUN}" -eq 1 && "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
fi

remove_wrapper() {
  run_root_cmd rm -f "${WRAPPER_PATH}"
}

purge_directories() {
  run_root_cmd rm -rf "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"
}

discover_compose_files() {
  local -a roots=()
  local root

  if [[ -d "${SCRIPT_DIR}/out" ]]; then
    roots+=("${SCRIPT_DIR}/out")
  fi

  if [[ "${INSTALL_DIR}" != "${SCRIPT_DIR}" && -d "${INSTALL_DIR}/out" ]]; then
    roots+=("${INSTALL_DIR}/out")
  fi

  if [[ "${#roots[@]}" -eq 0 ]]; then
    return 0
  fi

  local compose_path
  local -A seen=()
  for root in "${roots[@]}"; do
    while IFS= read -r -d '' compose_path; do
      if [[ -z "${seen[${compose_path}]:-}" ]]; then
        seen["${compose_path}"]=1
        printf '%s\0' "${compose_path}"
      fi
    done < <(find "${root}" -mindepth 2 -maxdepth 2 -type f -name docker-compose.yml -print0 2>/dev/null || true)
  done
}

teardown_stacks() {
  if [[ "${DOWN}" -ne 1 ]]; then
    log "Skipping docker compose teardown (--no-down)."
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "docker not found; skipping compose teardown."
    return 0
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log "docker compose plugin not found; skipping compose teardown."
    return 0
  fi

  local compose_path
  local env_path
  local found_any=0
  while IFS= read -r -d '' compose_path; do
    found_any=1
    env_path="$(dirname "${compose_path}")/.env"
    if [[ -f "${env_path}" ]]; then
      log "Tearing down stack: ${compose_path}"
      run_root_cmd docker compose -f "${compose_path}" --env-file "${env_path}" down --remove-orphans
    else
      log "Tearing down stack: ${compose_path} (no .env found)"
      run_root_cmd docker compose -f "${compose_path}" down --remove-orphans
    fi
  done < <(discover_compose_files)

  if [[ "${found_any}" -eq 0 ]]; then
    log "No generated compose stacks found under ${SCRIPT_DIR}/out or ${INSTALL_DIR}/out."
  fi
}

log "Starting uninstall (purge=${PURGE}, dry_run=${DRY_RUN}, down=${DOWN}, prefix=${INSTALL_DIR})"
run_step "Stop generated compose stacks" teardown_stacks
run_step "Remove wrapper ${WRAPPER_PATH}" remove_wrapper

if [[ "${PURGE}" -eq 1 ]]; then
  run_step "Purge install and runtime directories" purge_directories
fi

log "Uninstall complete."
