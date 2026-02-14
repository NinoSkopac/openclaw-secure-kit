#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[ocs-install]"
DEFAULT_PREFIX="/opt/openclaw-secure-kit"
WRAPPER_PATH="/usr/local/bin/ocs"
CONFIG_DIR="/etc/openclaw-secure"
STATE_DIR="/var/lib/openclaw-secure"

INSTALL_DIR="${DEFAULT_PREFIX}"
FORCE=0
DRY_RUN=0
NO_DEPS=0
SUDO=""
APT_UPDATED=0
CURRENT_STEP="startup"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "${LOG_PREFIX} ERROR: run this installer with sudo:"
  echo "${LOG_PREFIX}   sudo ./install.sh"
  exit 1
fi

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

run_cmd() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "[dry-run] $(format_cmd "$@")"
    return 0
  fi
  "$@"
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

run_root_shell() {
  local cmd="$1"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    if [[ -n "${SUDO}" ]]; then
      log "[dry-run] sudo bash -lc $(printf "%q" "${cmd}")"
    else
      log "[dry-run] bash -lc $(printf "%q" "${cmd}")"
    fi
    return 0
  fi

  if [[ -n "${SUDO}" ]]; then
    sudo bash -lc "${cmd}"
  else
    bash -lc "${cmd}"
  fi
}

run_step() {
  CURRENT_STEP="$1"
  shift
  log "STEP: ${CURRENT_STEP}"
  "$@"
  log "OK: ${CURRENT_STEP}"
}

usage() {
  cat <<EOF
Usage: ./install.sh [options]

Options:
  --force            Replace existing non-git install directory at prefix.
  --dry-run          Print planned actions without making changes.
  --no-deps          Skip dependency installation (assume deps already installed).
  --prefix <dir>     Install directory prefix (default: ${DEFAULT_PREFIX}).
  --version          Print source git commit (or 'unknown') and exit.
  -h, --help         Show this help message.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

get_source_commit() {
  git -C "${SCRIPT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

SOURCE_COMMIT="$(get_source_commit)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-deps)
      NO_DEPS=1
      shift
      ;;
    --prefix)
      [[ $# -ge 2 ]] || die "--prefix requires a directory path"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --version)
      echo "${SOURCE_COMMIT}"
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

if [[ ! -f "${SCRIPT_DIR}/package.json" ]]; then
  die "install.sh must be run from the repository root."
fi

if [[ ! -r "/etc/os-release" ]]; then
  die "Cannot detect OS: /etc/os-release not found."
fi

# shellcheck source=/dev/null
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  die "Unsupported OS: expected Ubuntu, got '${ID:-unknown}'."
fi
if [[ "${VERSION_ID:-}" != "22.04" && "${VERSION_ID:-}" != "24.04" ]]; then
  die "Unsupported Ubuntu version: expected 22.04 or 24.04, got '${VERSION_ID:-unknown}'."
fi

if [[ "${DRY_RUN}" -eq 0 && "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required to run this installer."
  log "Validating sudo access..."
  sudo -v
  SUDO="sudo"
elif [[ "${DRY_RUN}" -eq 1 && "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
fi

ensure_apt_updated() {
  if [[ "${APT_UPDATED}" -eq 0 ]]; then
    run_root_cmd apt-get update
    APT_UPDATED=1
  fi
}

ensure_node20_or_newer() {
  local node_major="0"
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi

  if [[ "${node_major}" -ge 20 ]]; then
    log "Node.js ${node_major} detected (>=20)."
    return
  fi

  log "Installing Node.js 20.x via NodeSource..."
  ensure_apt_updated
  run_root_cmd apt-get install -y ca-certificates curl gnupg
  run_root_shell "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  APT_UPDATED=0
  ensure_apt_updated
  run_root_cmd apt-get install -y nodejs
}

ensure_docker_with_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker engine and compose plugin already present."
    return
  fi

  log "Installing Docker engine and docker compose plugin..."
  ensure_apt_updated
  run_root_cmd apt-get install -y ca-certificates curl gnupg lsb-release
  run_root_cmd install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    run_root_shell "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
  fi
  run_root_cmd chmod a+r /etc/apt/keyrings/docker.gpg

  local arch codename docker_list
  arch="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:-}"
  docker_list="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable"
  run_root_shell "printf '%s\n' '${docker_list}' > /etc/apt/sources.list.d/docker.list"

  APT_UPDATED=0
  ensure_apt_updated
  run_root_cmd apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if command -v systemctl >/dev/null 2>&1; then
    run_root_cmd systemctl enable --now docker || true
  fi
}

ensure_base_tools() {
  local missing=()
  command -v git >/dev/null 2>&1 || missing+=("git")
  command -v nft >/dev/null 2>&1 || missing+=("nftables")

  if [[ "${#missing[@]}" -eq 0 ]]; then
    log "git and nftables already present."
    return
  fi

  log "Installing missing base packages: ${missing[*]}..."
  ensure_apt_updated
  run_root_cmd apt-get install -y "${missing[@]}"
}

check_deps_when_skipped() {
  local required=(docker node npm git nft)
  local missing=()
  local cmd
  for cmd in "${required[@]}"; do
    command -v "${cmd}" >/dev/null 2>&1 || missing+=("${cmd}")
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "--no-deps provided, but required commands are missing: ${missing[*]}"
  fi
  log "--no-deps enabled: dependency installation skipped."
}

get_installed_commit() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "${INSTALL_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

wrapper_points_to_prefix() {
  if [[ ! -f "${WRAPPER_PATH}" ]]; then
    return 1
  fi
  grep -Fq "exec node ${INSTALL_DIR}/dist/ocs.js" "${WRAPPER_PATH}"
}

check_idempotency() {
  if [[ ! -d "${INSTALL_DIR}" ]]; then
    return 1
  fi

  local installed_commit="unknown"
  installed_commit="$(get_installed_commit)"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    if [[ "${SOURCE_COMMIT}" != "unknown" && "${installed_commit}" != "unknown" && "${installed_commit}" == "${SOURCE_COMMIT}" ]]; then
      if [[ -f "${INSTALL_DIR}/dist/ocs.js" ]] && wrapper_points_to_prefix; then
        log "already installed (commit ${installed_commit}) at ${INSTALL_DIR}."
        return 0
      fi
    fi

    if [[ "${SOURCE_COMMIT}" != "unknown" && "${installed_commit}" != "unknown" && "${installed_commit}" != "${SOURCE_COMMIT}" ]]; then
      log "Different version detected: installed ${installed_commit}, source ${SOURCE_COMMIT}."
      log "Update behavior: run git pull --ff-only in ${INSTALL_DIR}, then rebuild."
    else
      log "Existing git install detected at ${INSTALL_DIR}; update behavior is git pull --ff-only + rebuild."
    fi
    return 1
  fi

  if [[ "${FORCE}" -ne 1 ]]; then
    die "${INSTALL_DIR} exists and is not a git repository. Re-run with --force to replace it."
  fi

  log "Non-git install directory detected at ${INSTALL_DIR}; --force will replace it."
  return 1
}

sync_repository() {
  if [[ -e "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}" ]]; then
    die "${INSTALL_DIR} exists and is not a directory."
  fi

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    run_root_cmd git -C "${INSTALL_DIR}" pull --ff-only
    return
  fi

  if [[ -d "${INSTALL_DIR}" && "${FORCE}" -eq 1 ]]; then
    run_root_cmd rm -rf "${INSTALL_DIR}"
  fi

  run_root_cmd mkdir -p "${INSTALL_DIR}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "[dry-run] tar --exclude=node_modules --exclude=dist --exclude=out -cf - . | ${SUDO:+sudo }tar -C ${INSTALL_DIR} -xf -"
  else
    (
      cd "${SCRIPT_DIR}" && \
        tar --exclude='node_modules' --exclude='dist' --exclude='out' -cf - .
    ) | run_root_cmd tar -C "${INSTALL_DIR}" -xf -
  fi
}

build_project() {
  run_root_cmd npm ci --prefix "${INSTALL_DIR}"
  run_root_cmd npm run build --prefix "${INSTALL_DIR}"
}

install_wrapper() {
  local wrapper_tmp
  wrapper_tmp="$(mktemp)"
  cat >"${wrapper_tmp}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node ${INSTALL_DIR}/dist/ocs.js "\$@"
EOF
  run_root_cmd install -m 0755 "${wrapper_tmp}" "${WRAPPER_PATH}"
  rm -f "${wrapper_tmp}"
}

create_data_dirs() {
  run_root_cmd install -d -m 0755 "${CONFIG_DIR}" "${STATE_DIR}"
}

log "Starting installer for Ubuntu ${VERSION_ID}."
log "Configuration: prefix=${INSTALL_DIR} force=${FORCE} dry_run=${DRY_RUN} no_deps=${NO_DEPS} source_commit=${SOURCE_COMMIT}"
log "This installer will set up docker/node/nftables/git (unless --no-deps), install repo, build, install wrapper, and create runtime dirs."

if check_idempotency; then
  exit 0
fi

if [[ "${NO_DEPS}" -eq 1 ]]; then
  run_step "Verify required dependencies (--no-deps)" check_deps_when_skipped
else
  run_step "Install Docker engine + compose plugin" ensure_docker_with_compose
  run_step "Install Node.js 20+ (NodeSource)" ensure_node20_or_newer
  run_step "Install git + nftables" ensure_base_tools
fi

run_step "Install or update repository at ${INSTALL_DIR}" sync_repository
run_step "Install npm dependencies and build" build_project
run_step "Install wrapper at ${WRAPPER_PATH}" install_wrapper
run_step "Create runtime directories" create_data_dirs

log "Installation complete."
log "Run: ocs install --profile research-only"
