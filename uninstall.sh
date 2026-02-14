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

log "Starting uninstall (purge=${PURGE}, dry_run=${DRY_RUN}, prefix=${INSTALL_DIR})"
run_step "Remove wrapper ${WRAPPER_PATH}" remove_wrapper

if [[ "${PURGE}" -eq 1 ]]; then
  run_step "Purge install and runtime directories" purge_directories
fi

log "Uninstall complete."
