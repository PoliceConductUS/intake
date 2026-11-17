#!/usr/bin/env bash
# Moves this repo into the folder layout AGENTS.md describes:
#
#   ~/dev/<owner>/<repo>/main/            the main (or master) branch
#   ~/dev/<owner>/<repo>/<branch-name>/   one folder per other branch
#
# Run it from any folder of the repo. With no argument it only reports what
# it would do. With --apply it moves the folders, repairs the git worktree
# links, and copies the Claude Code and Codex per-folder settings to the new
# paths. Uncommitted changes move as they are.
#
# The move needs exclusive access: it stops if any other process is using a
# folder that has to move, and prints the command that stops those processes.
set -euo pipefail

main() {
  local apply=0
  if [[ "${1:-}" == "--apply" ]]; then
    apply=1
  elif [[ $# -gt 0 ]]; then
    echo "usage: restructure-repo.sh [--apply]" >&2
    exit 64
  fi

  # Worktree list: one "path<TAB>branch" line each, main checkout first.
  # A detached worktree has an empty branch.
  local listing
  listing=$(git worktree list --porcelain | awk '
    /^worktree / { if (path != "") print path "\t" branch; path = substr($0, 10); branch = "" }
    /^branch refs\/heads\// { branch = substr($0, 19) }
    END { if (path != "") print path "\t" branch }')

  local main_old repo_dir main_new move_main=0
  main_old=$(printf '%s\n' "$listing" | head -1 | cut -f1)
  if [[ "$(basename "$main_old")" == "main" ]]; then
    repo_dir=$(dirname "$main_old")
    main_new=$main_old
  else
    repo_dir=$main_old
    main_new="$repo_dir/main"
    move_main=1
  fi

  # Plan: "old<TAB>new" for every folder, main checkout first.
  local plan="$main_old	$main_new" path branch name target
  while IFS=$'\t' read -r path branch; do
    [[ "$path" == "$main_old" ]] && continue
    if [[ -n "$branch" ]]; then name=${branch//\//-}; else name=$(basename "$path"); fi
    target="$repo_dir/$name"
    if [[ "$name" == "main" ]]; then
      echo "Cannot place $path: its folder would be named 'main'." >&2
      exit 1
    fi
    plan="$plan"$'\n'"$path	$target"
  done <<<"$listing"

  local duplicates
  duplicates=$(printf '%s\n' "$plan" | cut -f2 | sort | uniq -d)
  if [[ -n "$duplicates" ]]; then
    echo "Two worktrees would land in the same folder:" >&2
    echo "$duplicates" >&2
    exit 1
  fi

  local pending
  pending=$(printf '%s\n' "$plan" | awk -F'\t' '$1 != $2')
  if [[ -z "$pending" ]]; then
    echo "Layout is correct: $repo_dir"
    exit 0
  fi

  echo "This repo is not in the layout AGENTS.md describes."
  echo "Folders to move:"
  printf '%s\n' "$pending" | awk -F'\t' '{ print "  " $1 "\n    -> " $2 }'

  # A target may already exist only if it is inside a tree that is moving.
  local old new
  while IFS=$'\t' read -r old new; do
    if [[ -e "$new" && $move_main -eq 0 ]]; then
      echo "Target already exists: $new" >&2
      exit 1
    fi
  done <<<"$pending"

  # Folders that must not be in use: the whole repo folder when the main
  # checkout moves, otherwise only the worktrees that move.
  local roots
  if [[ $move_main -eq 1 ]]; then
    roots=$(printf '%s\n%s\n' "$repo_dir" "$(printf '%s\n' "$pending" | cut -f1 | grep -v -F "$repo_dir/" | grep -v -x -F "$repo_dir" || true)")
  else
    roots=$(printf '%s\n' "$pending" | cut -f1)
  fi

  # This script and the processes that started it are allowed.
  local allowed=" " pid=$$
  while [[ -n "$pid" && "$pid" != "0" ]]; do
    allowed="$allowed$pid "
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  done

  local users blockers="" inside_session=0 line
  users=$(lsof -F pcn 2>/dev/null | ROOTS="$roots" awk '
    BEGIN { n = split(ENVIRON["ROOTS"], root, "\n") }
    /^p/ { pid = substr($0, 2) }
    /^c/ { cmd = substr($0, 2) }
    /^n/ {
      file = substr($0, 2)
      for (i = 1; i <= n; i++) {
        if (root[i] != "" && (file == root[i] || index(file, root[i] "/") == 1)) { print pid "\t" cmd; break }
      }
    }' | sort -u || true)
  while IFS=$'\t' read -r pid line; do
    [[ -z "$pid" ]] && continue
    if [[ "$allowed" == *" $pid "* ]]; then
      [[ "$pid" != "$$" ]] && inside_session=1
      continue
    fi
    kill -0 "$pid" 2>/dev/null || continue
    blockers="$blockers$pid	$line"$'\n'
  done <<<"$users"

  if [[ -n "$blockers" ]]; then
    echo
    echo "These processes are using folders that have to move:"
    printf '%s' "$blockers" | awk -F'\t' '{ printf "  %-8s %s\n", $1, $2 }'
    echo "Stop them, then run this script again. To stop them:"
    echo "  kill $(printf '%s' "$blockers" | cut -f1 | sort -un | tr '\n' ' ')"
    [[ $apply -eq 1 ]] && exit 2
    exit 0
  fi

  if [[ $apply -eq 0 ]]; then
    echo
    echo "Nothing else is using these folders. To move them, run:"
    echo "  bash scripts/restructure-repo.sh --apply"
    exit 0
  fi

  if [[ $move_main -eq 1 ]]; then
    local staging="$repo_dir.restructure-$$"
    mv "$repo_dir" "$staging"
    mkdir "$repo_dir"
    mv "$staging" "$main_new"
  fi

  local current targets=()
  while IFS=$'\t' read -r old new; do
    [[ "$old" == "$main_old" ]] && continue
    current=$old
    if [[ $move_main -eq 1 && "$old" == "$repo_dir/"* ]]; then
      current="$main_new/${old#"$repo_dir"/}"
    fi
    [[ "$current" != "$new" ]] && mv "$current" "$new"
    targets+=("$new")
  done <<<"$plan"
  rmdir "$main_new/.worktrees" 2>/dev/null || true

  if [[ ${#targets[@]} -gt 0 ]]; then
    git -C "$main_new" worktree repair "${targets[@]}" >/dev/null 2>&1
  fi

  # Claude Code keeps memory and session history in a folder named after the
  # working folder. Codex keeps a trust entry per working folder.
  local claude_projects="$HOME/.claude/projects" codex_config="$HOME/.codex/config.toml" from to trust
  while IFS=$'\t' read -r old new; do
    [[ "$old" == "$new" ]] && continue
    from="$claude_projects/$(printf '%s' "$old" | sed 's/[^A-Za-z0-9]/-/g')"
    to="$claude_projects/$(printf '%s' "$new" | sed 's/[^A-Za-z0-9]/-/g')"
    if [[ -d "$from" && ! -e "$to" ]]; then
      cp -Rp "$from" "$to"
      echo "Copied Claude Code memory and history to $to"
    fi
    if [[ -f "$codex_config" ]] && grep -q -F "[projects.\"$old\"]" "$codex_config" &&
      ! grep -q -F "[projects.\"$new\"]" "$codex_config"; then
      trust=$(grep -A1 -F "[projects.\"$old\"]" "$codex_config" | tail -1 | sed 's/^ *//')
      printf '\n[projects."%s"]\n%s\n' "$new" "$trust" >>"$codex_config"
      echo "Added a Codex project entry for $new"
    fi
  done <<<"$plan"

  echo
  echo "Moved. The layout is now:"
  git -C "$main_new" worktree list
  echo
  echo "Next:"
  if [[ $inside_session -eq 1 ]]; then
    echo "  - Close this session and start a new one in $main_new"
  fi
  echo "  - Reopen editor projects from their new folders."
  echo "  - Run 'mise trust' in each folder that has a mise.toml."
  echo "  - Rebuild anything that stores absolute paths, such as Python virtual environments."
}

main "$@"
