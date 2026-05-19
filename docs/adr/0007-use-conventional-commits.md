# ADR 0007: Use Conventional Commits

## Status

Proposed

## Context

This repo expects short-lived branches, frequent integration, and clear history.
Commit messages should make the purpose of a change obvious without requiring a
developer to inspect the diff first.

The project already uses examples such as `docs: propose <change-name>`,
`feat: implement <change-name>`, and `docs: archive <change-name>`. Those should
be a rule, not just examples.

## Decision

Use Conventional Commits for all commits.

Commit messages should follow this shape:

```text
<type>(optional-scope): <short imperative summary>
```

Examples:

```text
docs: propose validate-intake-package
feat(cli): add validate command scaffold
fix(seed): correct duplicate agency reference
test(cli): cover unreadable manifest path
chore(tooling): add TypeScript build
```

Use `BREAKING CHANGE:` in the commit body when a commit intentionally breaks
backward compatibility.

Common types for this repo:

- `feat` - user-visible behavior or supported capability
- `fix` - correction to intended behavior
- `docs` - documentation, ADRs, OpenSpec artifacts, README, or AGENTS changes
- `test` - tests only
- `refactor` - internal code change that preserves behavior
- `chore` - tooling, dependency, repository maintenance, or generated metadata
- `ci` - continuous integration

Developers may use Commitizen to build compliant messages interactively:

- [Commitizen CLI](https://github.com/commitizen/cz-cli)
- [Commitizen commit command docs](https://commitizen-tools.github.io/commitizen/commands/commit/)

## Consequences

- Commit history is easier to scan during review, release notes, and rollback.
- Squash commits and merge commits should also use Conventional Commit format.
- Agents should propose and create commits using Conventional Commit messages.
- Tooling may later enforce this rule with commitlint or a commit message hook,
  but this ADR does not require enforcement yet.
