#!/usr/bin/env bash
set -euo pipefail

MODE="install"
ASSUME_YES="false"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

export SUPABASE_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1

INFO_ITEMS=()
INSTALL_ITEMS=()
INSTALL_COMMANDS=()
MANUAL_ITEMS=()
CHECK_ERRORS=()
SEED_SQL_PATH="$ROOT_DIR/supabase/seed.sql"

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --check)
      MODE="check"
      ;;
    --yes|-y)
      ASSUME_YES="true"
      ;;
    *)
      fail "Unknown argument: $arg"
      ;;
  esac
done

have() {
  command -v "$1" >/dev/null 2>&1
}

append_unique() {
  local array_name="$1"
  local item="$2"
  local existing
  declare -n target_array="$array_name"

  for existing in "${target_array[@]}"; do
    if [[ "$existing" == "$item" ]]; then
      return
    fi
  done

  target_array+=("$item")
}

load_homebrew_shellenv() {
  if have brew; then
    return
  fi

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ask_to_install() {
  if [[ "${#INSTALL_ITEMS[@]}" -eq 0 ]]; then
    return
  fi

  if [[ "$MODE" == "check" ]]; then
    fail "Missing installable dependencies found. Run ./scripts/bootstrap-dev.sh to install them."
  fi

  if [[ "$ASSUME_YES" == "true" ]]; then
    info "Installing missing dependencies: yes (--yes)"
    return
  fi

  if [[ ! -t 0 ]]; then
    fail "Missing dependencies require approval. Rerun with --yes or run in an interactive terminal."
  fi

  while true; do
    printf 'Install the missing dependencies listed above? [y/q] '
    read -r answer
    case "$answer" in
      y|Y|yes|YES)
        return
        ;;
      q|Q|quit|QUIT|"")
        fail "User quit before installing missing dependencies."
        ;;
      *)
        warn "Answer y to install or q to quit."
        ;;
    esac
  done
}

print_list() {
  local title="$1"
  shift
  local items=("$@")
  local item

  if [[ "${#items[@]}" -eq 0 ]]; then
    printf '%s: none\n' "$title"
    return
  fi

  printf '%s:\n' "$title"
  for item in "${items[@]}"; do
    printf '  - %s\n' "$item"
  done
}

detect_homebrew() {
  info "Checking for Homebrew"
  load_homebrew_shellenv

  if have brew; then
    append_unique INFO_ITEMS "Homebrew found at $(command -v brew)"
  else
    append_unique INSTALL_ITEMS "Homebrew using the official non-interactive installer"
    append_unique INSTALL_COMMANDS "NONINTERACTIVE=1 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  fi
}

detect_brewfile() {
  info "Checking Homebrew dependencies from Brewfile"

  if ! have brew; then
    append_unique INSTALL_ITEMS "Brewfile dependencies after Homebrew is installed"
    append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
    return
  fi

  if HOMEBREW_NO_AUTO_UPDATE=1 brew bundle check --file "$ROOT_DIR/Brewfile" >/dev/null 2>&1; then
    append_unique INFO_ITEMS "Brewfile dependencies are satisfied"
  else
    append_unique INSTALL_ITEMS "missing Homebrew dependencies from Brewfile"
    append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
  fi
}

detect_git() {
  info "Checking for Git"

  if have git; then
    append_unique INFO_ITEMS "Git $(git --version | sed 's/^git version //') is available at $(command -v git)"
    return
  fi

  case "$(uname -s)" in
    Darwin)
      append_unique INSTALL_ITEMS "Git from Brewfile"
      append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
      ;;
    Linux)
      if have apt-get; then
        append_unique INSTALL_ITEMS "Git with apt"
        append_unique INSTALL_COMMANDS "sudo apt-get update"
        append_unique INSTALL_COMMANDS "sudo apt-get install -y git"
      elif have dnf; then
        append_unique INSTALL_ITEMS "Git with dnf"
        append_unique INSTALL_COMMANDS "sudo dnf install -y git"
      elif have pacman; then
        append_unique INSTALL_ITEMS "Git with pacman"
        append_unique INSTALL_COMMANDS "sudo pacman -Sy --needed git"
      else
        append_unique INSTALL_ITEMS "Git from Brewfile"
        append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
      fi
      ;;
    *)
      append_unique CHECK_ERRORS "unsupported OS for Git bootstrap: $(uname -s)"
      ;;
  esac
}

detect_github_cli() {
  info "Checking for GitHub CLI from mise.toml"

  if ! have mise; then
    append_unique INSTALL_ITEMS "GitHub CLI from mise.toml after mise is installed"
    append_unique INSTALL_COMMANDS "mise install"
    append_unique MANUAL_ITEMS "authenticate GitHub CLI after installation with: mise exec -- gh auth login"
    return
  fi

  if mise exec -- gh --version >/dev/null 2>&1; then
    append_unique INFO_ITEMS "GitHub CLI $(mise exec -- gh --version | head -n 1 | awk '{print $3}') is available through mise"
    if mise exec -- gh auth status -h github.com >/dev/null 2>&1; then
      append_unique INFO_ITEMS "GitHub CLI is authenticated for github.com"
    else
      append_unique MANUAL_ITEMS "authenticate GitHub CLI with: mise exec -- gh auth login"
    fi
  else
    append_unique INSTALL_ITEMS "GitHub CLI from mise.toml"
    append_unique INSTALL_COMMANDS "mise install"
    append_unique MANUAL_ITEMS "authenticate GitHub CLI after installation with: mise exec -- gh auth login"
  fi
}

detect_mise() {
  info "Checking for mise"

  if have mise; then
    append_unique INFO_ITEMS "mise is available at $(command -v mise)"
  else
    append_unique INSTALL_ITEMS "mise from Brewfile"
    append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
  fi
}

detect_mise_trust() {
  info "Checking mise trust for mise.toml"

  if ! have mise; then
    append_unique INSTALL_ITEMS "trust mise.toml after mise is installed"
    append_unique INSTALL_COMMANDS "mise trust \"$ROOT_DIR/mise.toml\""
    return
  fi

  if mise config ls >/dev/null 2>&1; then
    append_unique INFO_ITEMS "mise.toml is trusted"
  else
    append_unique INSTALL_ITEMS "trust mise.toml for this checkout"
    append_unique INSTALL_COMMANDS "mise trust \"$ROOT_DIR/mise.toml\""
  fi
}

detect_uv() {
  info "Checking for uv from mise.toml"

  if ! have mise; then
    append_unique INSTALL_ITEMS "uv from mise.toml after mise is installed"
    append_unique INSTALL_COMMANDS "mise install"
    append_unique MANUAL_ITEMS "uvx will provide a Python/tool environment for SQLFluff after uv is installed"
    return
  fi

  if mise exec -- uv --version >/dev/null 2>&1; then
    append_unique INFO_ITEMS "uv $(mise exec -- uv --version | awk '{print $2}') is available through mise"
    append_unique INFO_ITEMS "Python for SQLFluff is managed by uvx as needed"
  else
    append_unique INSTALL_ITEMS "uv from mise.toml"
    append_unique INSTALL_COMMANDS "mise install"
    append_unique MANUAL_ITEMS "uvx will provide a Python/tool environment for SQLFluff after uv is installed"
  fi
}

detect_node() {
  info "Checking Node.js version from mise.toml"

  if ! have mise; then
    append_unique INSTALL_ITEMS "mise-managed tools from mise.toml after mise is installed"
    append_unique INSTALL_COMMANDS "mise install"
    return
  fi

  if mise exec -- node --version >/dev/null 2>&1 && mise exec -- npm --version >/dev/null 2>&1; then
    append_unique INFO_ITEMS "Node $(mise exec -- node --version) and npm $(mise exec -- npm --version) are available through mise"
  else
    append_unique INSTALL_ITEMS "mise-managed tools from mise.toml"
    append_unique INSTALL_COMMANDS "mise install"
  fi
}

detect_npm_dependencies() {
  info "Checking project npm dependencies"

  if [[ -d node_modules ]] && have mise && mise exec -- npm ls --depth=0 >/dev/null 2>&1; then
    append_unique INFO_ITEMS "project npm dependencies are installed"
  else
    append_unique INSTALL_ITEMS "project npm dependencies with npm install"
    append_unique INSTALL_COMMANDS "npm install"
  fi
}

detect_docker() {
  info "Checking for Docker"

  if have docker; then
    append_unique INFO_ITEMS "Docker CLI found at $(command -v docker)"
    if docker info >/dev/null 2>&1; then
      append_unique INFO_ITEMS "Docker daemon is running"
    else
      append_unique MANUAL_ITEMS "start Docker Desktop on macOS, or start the Docker service on Linux"
    fi
    return
  fi

  case "$(uname -s)" in
    Darwin)
      append_unique INSTALL_ITEMS "Docker Desktop from Brewfile"
      append_unique INSTALL_COMMANDS "brew bundle --file \"$ROOT_DIR/Brewfile\""
      append_unique MANUAL_ITEMS "start Docker Desktop after installation"
      ;;
    Linux)
      if have apt-get; then
        append_unique INSTALL_ITEMS "Docker with apt"
        append_unique INSTALL_COMMANDS "sudo apt-get update"
        append_unique INSTALL_COMMANDS "sudo apt-get install -y docker.io docker-compose-plugin"
      elif have dnf; then
        append_unique INSTALL_ITEMS "Docker with dnf"
        append_unique INSTALL_COMMANDS "sudo dnf install -y docker docker-compose-plugin"
      elif have pacman; then
        append_unique INSTALL_ITEMS "Docker with pacman"
        append_unique INSTALL_COMMANDS "sudo pacman -Sy --needed docker docker-compose"
      else
        append_unique INSTALL_ITEMS "Docker CLI with Homebrew"
        append_unique INSTALL_COMMANDS "brew install docker docker-compose"
        append_unique MANUAL_ITEMS "install/start a Docker daemon for this Linux distribution if Homebrew only installs the client"
      fi
      append_unique MANUAL_ITEMS "start the Docker service after installation"
      ;;
    *)
      append_unique CHECK_ERRORS "unsupported OS for Docker bootstrap: $(uname -s)"
      ;;
  esac
}

detect_project_tools() {
  info "Checking OpenSpec and Supabase CLI packages"

  if [[ -x node_modules/.bin/openspec ]]; then
    append_unique INFO_ITEMS "local OpenSpec CLI package is installed"
  else
    append_unique INSTALL_ITEMS "OpenSpec CLI npm package via npm install"
    append_unique INSTALL_COMMANDS "npm install"
  fi

  if [[ -x node_modules/.bin/supabase ]]; then
    append_unique INFO_ITEMS "local Supabase CLI package is installed"
  else
    append_unique INSTALL_ITEMS "Supabase CLI npm package via npm install"
    append_unique INSTALL_COMMANDS "npm install"
  fi
}

detect_seed_sql() {
  local seed_source

  info "Checking ignored Supabase seed file"

  if [[ -r "$SEED_SQL_PATH" ]]; then
    append_unique INFO_ITEMS "Supabase seed file is available at $SEED_SQL_PATH"
    return
  fi

  if seed_source="$(bash scripts/link-seed.sh --source-only)"; then
    append_unique INSTALL_ITEMS "local ignored Supabase seed.sql symlink from $seed_source"
    append_unique INSTALL_COMMANDS "npm run link-seed"
  else
    append_unique MANUAL_ITEMS "provide ignored Supabase seed file at $SEED_SQL_PATH before running npm run supabase:reset"
  fi
}

detect_codex_app() {
  info "Checking for Codex App"

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -d "/Applications/Codex.app" ]]; then
      append_unique INFO_ITEMS "Codex App found at /Applications/Codex.app"
      return
    fi

    if [[ -d "$HOME/Applications/Codex.app" ]]; then
      append_unique INFO_ITEMS "Codex App found at $HOME/Applications/Codex.app"
      return
    fi
  fi

  if have codex; then
    append_unique INFO_ITEMS "Codex CLI found at $(command -v codex)"
    return
  fi

  append_unique MANUAL_ITEMS "install/open Codex App and verify this repo is opened at $ROOT_DIR"
}

detect_superpowers() {
  info "Checking Superpowers agent guidance"

  append_unique MANUAL_ITEMS "verify Superpowers skills are available inside Codex App; this script does not run interactive agent plugin commands"
}

detect_all() {
  detect_homebrew
  detect_brewfile
  detect_git
  detect_mise
  detect_mise_trust
  detect_github_cli
  detect_uv
  detect_node
  detect_npm_dependencies
  detect_docker
  detect_project_tools
  detect_seed_sql
  detect_codex_app
  detect_superpowers
}

print_summary() {
  printf '\nDependency check summary\n'
  printf '========================\n'
  print_list "Already available" "${INFO_ITEMS[@]}"
  print_list "Missing and installable" "${INSTALL_ITEMS[@]}"
  print_list "Install commands that will run" "${INSTALL_COMMANDS[@]}"
  print_list "Manual follow-up" "${MANUAL_ITEMS[@]}"
  print_list "Blocking check errors" "${CHECK_ERRORS[@]}"
  printf '\n'
}

install_homebrew_if_needed() {
  if have brew; then
    return
  fi

  info "Installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_shellenv
  have brew || fail "Homebrew installed, but brew is not on PATH. Open a new shell and rerun this script."
}

install_brewfile_if_needed() {
  install_homebrew_if_needed

  if HOMEBREW_NO_AUTO_UPDATE=1 brew bundle check --file "$ROOT_DIR/Brewfile" >/dev/null 2>&1; then
    return
  fi

  info "Installing Homebrew dependencies from Brewfile"
  brew bundle --file "$ROOT_DIR/Brewfile"
}

install_mise_tools_if_needed() {
  install_brewfile_if_needed
  have mise || fail "mise is installed but could not be loaded. Open a new shell and rerun this script."
  install_mise_trust_if_needed

  if ! mise exec -- node --version >/dev/null 2>&1 || \
    ! mise exec -- npm --version >/dev/null 2>&1 || \
    ! mise exec -- gh --version >/dev/null 2>&1 || \
    ! mise exec -- uv --version >/dev/null 2>&1; then
    info "Installing tools from mise.toml"
    mise install
  fi
}

install_node_if_needed() {
  install_mise_tools_if_needed
}

install_mise_trust_if_needed() {
  have mise || return

  if mise config ls >/dev/null 2>&1; then
    return
  fi

  info "Trusting mise.toml for this checkout"
  mise trust "$ROOT_DIR/mise.toml"
}

install_uv_if_needed() {
  if have mise && mise exec -- uv --version >/dev/null 2>&1; then
    return
  fi

  install_mise_tools_if_needed
}

install_git_if_needed() {
  if have git; then
    return
  fi

  case "$(uname -s)" in
    Darwin)
      install_brewfile_if_needed
      ;;
    Linux)
      if have apt-get; then
        info "Installing Git with apt"
        sudo apt-get update
        sudo apt-get install -y git
      elif have dnf; then
        info "Installing Git with dnf"
        sudo dnf install -y git
      elif have pacman; then
        info "Installing Git with pacman"
        sudo pacman -Sy --needed git
      else
        install_brewfile_if_needed
      fi
      ;;
  esac
}

install_github_cli_if_needed() {
  if have mise && mise exec -- gh --version >/dev/null 2>&1; then
    return
  fi

  install_mise_tools_if_needed
}

install_docker_if_needed() {
  if have docker; then
    return
  fi

  case "$(uname -s)" in
    Darwin)
      install_brewfile_if_needed
      ;;
    Linux)
      if have apt-get; then
        info "Installing Docker with apt"
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-plugin
      elif have dnf; then
        info "Installing Docker with dnf"
        sudo dnf install -y docker docker-compose-plugin
      elif have pacman; then
        info "Installing Docker with pacman"
        sudo pacman -Sy --needed docker docker-compose
      else
        install_homebrew_if_needed
        info "Installing Docker CLI with Homebrew"
        brew install docker docker-compose
      fi
      ;;
  esac
}

install_npm_dependencies_if_needed() {
  install_node_if_needed

  if mise exec -- npm ls --depth=0 >/dev/null 2>&1; then
    return
  fi

  info "Installing project npm dependencies"
  mise exec -- npm install
}

install_seed_sql_if_needed() {
  if [[ -r "$SEED_SQL_PATH" ]]; then
    return
  fi

  mise exec -- npm run link-seed
}

install_missing() {
  install_homebrew_if_needed
  install_brewfile_if_needed
  install_git_if_needed
  install_github_cli_if_needed
  install_mise_trust_if_needed
  install_uv_if_needed
  install_mise_tools_if_needed
  install_docker_if_needed
  install_npm_dependencies_if_needed
  install_seed_sql_if_needed
}

verify_github_cli_auth() {
  info "Verifying GitHub CLI authentication"

  have mise || fail "mise is not installed. Run ./scripts/bootstrap-dev.sh first."

  if ! mise exec -- gh --version >/dev/null 2>&1; then
    fail "GitHub CLI is not installed through mise. Run ./scripts/bootstrap-dev.sh first."
  fi

  if ! mise exec -- gh auth status -h github.com >/dev/null 2>&1; then
    fail "GitHub CLI is not authenticated. Run mise exec -- gh auth login, then rerun npm run doctor."
  fi
}

verify_project_tools() {
  verify_github_cli_auth

  info "Verifying OpenSpec"
  mise exec -- npx openspec --version >/dev/null
  mise exec -- npm run openspec:validate

  info "Verifying Supabase CLI"
  mise exec -- npx supabase --version >/dev/null
}

main() {
  info "Bootstrapping intake development environment ($MODE mode)"
  detect_all
  print_summary

  if [[ "${#CHECK_ERRORS[@]}" -gt 0 ]]; then
    fail "Resolve blocking check errors before continuing."
  fi

  ask_to_install

  if [[ "$MODE" != "check" && "${#INSTALL_ITEMS[@]}" -gt 0 ]]; then
    install_missing
  fi

  if [[ "$MODE" != "check" ]]; then
    install_node_if_needed
  else
    if have mise; then
      mise exec -- node --version >/dev/null 2>&1 || true
    fi
  fi

  verify_project_tools

  if have docker && docker info >/dev/null 2>&1; then
    info "Docker is installed and running"
  else
    warn "Docker is not running. Start it before running Supabase locally."
  fi

  warn "Superpowers is agent-specific. Verify it inside your coding agent."
  info "Bootstrap complete"
}

main "$@"
