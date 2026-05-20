#!/usr/bin/env bash
set -euo pipefail

MODE="link"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SEED_SQL_PATH="$ROOT_DIR/supabase/seed.sql"
SEED_SQL_RELATIVE_PATH="supabase/seed.sql"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --source-only)
      MODE="source-only"
      ;;
    *)
      fail "Unknown argument: $arg"
      ;;
  esac
done

current_worktree_path() {
  git -C "$ROOT_DIR" worktree list --porcelain | awk '
    /^worktree / { worktree = substr($0, 10) }
    /^branch / {
      if (worktree == root) {
        print worktree
        found = 1
        exit
      }
    }
    END { if (!found) exit 1 }
  ' root="$ROOT_DIR"
}

verify_current_worktree() {
  local git_root
  local worktree_path

  command -v git >/dev/null 2>&1 || fail "Git is required to link seed.sql."

  git_root="$(git -C "$ROOT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ "$git_root" == "$ROOT_DIR" ]] || fail "Run npm run link-seed from this repository checkout."

  worktree_path="$(current_worktree_path || true)"
  [[ "$worktree_path" == "$ROOT_DIR" ]] || fail "This checkout is not listed as an active git worktree."
}

verify_seed_is_ignored() {
  if ! git -C "$ROOT_DIR" check-ignore -q "$SEED_SQL_RELATIVE_PATH"; then
    fail "$SEED_SQL_RELATIVE_PATH is not ignored by git. Refusing to create a local seed link that could be committed."
  fi
}

find_seed_sql_source() {
  local worktree_path
  local candidate

  while IFS= read -r worktree_path; do
    candidate="$worktree_path/supabase/seed.sql"
    if [[ "$candidate" != "$SEED_SQL_PATH" && -r "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(git -C "$ROOT_DIR" worktree list --porcelain | sed -n 's/^worktree //p')

  return 1
}

verify_current_worktree
verify_seed_is_ignored

if [[ -r "$SEED_SQL_PATH" ]]; then
  if [[ "$MODE" != "source-only" ]]; then
    printf 'Supabase seed file is available at %s\n' "$SEED_SQL_PATH"
  fi
  exit 0
fi

seed_source="$(find_seed_sql_source || true)"

if [[ -z "$seed_source" ]]; then
  if [[ "$MODE" == "source-only" ]]; then
    exit 1
  fi

  printf 'ERROR: No readable supabase/seed.sql found in this checkout or another local worktree.\n' >&2
  printf 'Provide ignored seed file at %s before running npm run supabase:reset.\n' "$SEED_SQL_PATH" >&2
  exit 1
fi

if [[ "$MODE" == "source-only" ]]; then
  printf '%s\n' "$seed_source"
  exit 0
fi

printf 'Linking ignored Supabase seed file from %s\n' "$seed_source"
ln -s "$seed_source" "$SEED_SQL_PATH"
