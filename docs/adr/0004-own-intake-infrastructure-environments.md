# ADR 0004: Own Intake Infrastructure Environments

## Status

Proposed

## Context

The intake system cannot operate without storage and database infrastructure.
Local development needs a working environment. Production needs durable archive
storage. Pull requests need isolated environments for validation without
polluting shared state.

The system is not yet a long-running service, so infrastructure commands should
remain project scripts rather than intake CLI verbs.

## Decision

This repo owns infrastructure needed to operate intake.

Use npm scripts for infrastructure jobs, not `intake infra ...` CLI commands.

Initial script shape:

```bash
npm run infra:local:up
npm run infra:dev:plan
npm run infra:dev:apply
npm run infra:prod:plan
npm run infra:prod:apply
```

Environment expectations:

- Local: Docker/Supabase local and local S3-compatible storage when needed.
- PR: isolated database target and isolated S3 bucket or prefix per PR.
- Prod: durable S3 archive bucket, production database target, least-privilege
  IAM, and protected destructive operations.

## Consequences

- Infrastructure is explicit and repeatable.
- Intake CLI stays focused on package lifecycle.
- PR validation can exercise archive/database behavior in isolation.
- Production archive rules can be stricter than local development.

## Alternatives Considered

- `intake infra up local`: rejected because infrastructure management is not the
  core intake domain command surface.
- Manual infrastructure setup: rejected because it makes local and PR validation
  hard to reproduce.

## Revisit Trigger

Revisit if intake becomes a long-running service and infrastructure operations
need to be exposed through a deployment control plane.
