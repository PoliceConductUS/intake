# ADR 0007: Use Conventional Commits

## Status

Accepted

## Context

This repo expects short-lived branches, frequent integration, and clear history.
Commit messages should make the purpose of a change obvious without requiring a
developer to inspect the diff first.

The shared Institute for Police Conduct engineering standards already require
Conventional Commits. This repo records the same rule locally so agents and
contributors do not need access to the shared standards repo to know the commit
contract.

## Decision

Adopt the shared Conventional Commits standard for all commits in this repo.

Commit messages should follow this shape:

```text
<type>(optional-scope): <short imperative summary>
```

Examples:

```text
docs: propose validate-intake-artifacts
feat(cli): add import artifacts command
fix(seed): correct duplicate agency reference
test(cli): cover unreadable artifacts path
chore(tooling): add TypeScript build
```

Use `BREAKING CHANGE:` in the commit body when a commit intentionally breaks a
documented contract.

Developers may use Commitizen to build compliant messages interactively:

- [Commitizen CLI](https://github.com/commitizen/cz-cli)
- [Commitizen commit command docs](https://commitizen-tools.github.io/commitizen/commands/commit/)

## Consequences

- Commit history is easier to scan during review, release notes, and rollback.
- Squash commits and merge commits should also use Conventional Commit format.
- Agents should propose and create commits using Conventional Commit messages.
- Tooling may later enforce this rule with commitlint or a commit message hook,
  but this ADR does not require enforcement yet.
