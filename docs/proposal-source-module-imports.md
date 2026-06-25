# Proposal: Source Module Imports

## Why

The intake CLI needs to orchestrate source-specific import modules without
embedding every source scraper and normalizer in the core intake project.
Minnesota POST is the first concrete source that needs this boundary. Intake
should own operator commands, workspace layout, hydration, and upload, while
source modules own source-specific collection and packet production.

## What Changes

**Source Module Registry**

- From: Intake has no source module registry.
- To: Intake reads `modules.config.yaml` to resolve import modules by
  jurisdiction and source.
- Reason: Operators need stable commands such as `intake import mn post` while
  source implementations remain independently maintained.
- Impact: New intake orchestration behavior.

**Import Command**

- From: Intake validates local artifacts paths only.
- To: Intake supports `intake import [options] [jurisdiction] [source]`.
- Reason: Intake should run one source, a jurisdiction scope, or all configured
  sources.
- Impact: New CLI behavior.

**Upload Command**

- From: Source-specific upload is undefined.
- To: Intake supports `intake upload [jurisdiction] [source]` and owns remote
  sync for configured source workspaces.
- Reason: Upload policy should be consistent across import modules.
- Impact: New CLI behavior and remote storage configuration.

## Proposed Configuration

```yaml
import:
  mn:
    post:
      executable: intake-mn-post
```

Intake derives these values from the YAML path:

- jurisdiction: `mn`
- source: `post`
- source workspace path: `import/mn/post`

The module executable reports metadata such as display name and version through
its own CLI. `modules.config.yaml` remains a dispatch registry, not a duplicated
module manifest.

Executable values may be:

- a command resolved from `PATH`
- a relative path resolved from the config file directory
- an absolute path

## Operator Commands

```bash
intake import
intake import mn
intake import mn post
intake import --no-upload mn post
intake upload
intake upload mn
intake upload mn post
```

Option placement is strict in v1:

```bash
intake import --no-upload mn post
```

The following is invalid in v1:

```bash
intake import mn post --no-upload
```

## Scope Behavior

`intake import` runs every configured import module.

`intake import mn` runs every configured import module under `import.mn`.

`intake import mn post` runs only the Minnesota POST module.

Unknown scopes fail loudly.

For broad scopes, intake should continue through matching modules, collect all
module failures, and return a failed import result if any module failed.

## Workspace Ownership

Intake owns `$INTAKE_WORKSPACE/intake/`. Each source module owns only its own
namespace folder under the workspace. Intake may create command folders for
itself and for submodule calls; submodules must write command-local artifacts
and state only under their own namespace.

Example:

```text
$INTAKE_WORKSPACE/
  intake/
    commands/
      2026-06-11T21-00-00-000Z-command-name/
    state/
      namespaces/
        mn-post/
  mn-post/
    commands/
      2026-06-11T21-00-00-000Z-command-name/
    state/
```

For `mn-post`, intake provides:

```text
$INTAKE_WORKSPACE/mn-post
```

The module must write all source state and command artifacts under that assigned
namespace workspace.

## Canonical Resolution Ownership

Source modules produce source-specific packets. Intake owns canonical database
values that must be consistent across sources and imports.

For imported agencies, intake resolves or creates `location_path_id` from
source-provided location hints such as address, city, state, and ZIP code.
Source modules must preserve those hints, but they do not choose canonical
location paths. If intake cannot resolve or create the required location path,
the import fails loudly before writing a partial agency row.

Intake also owns canonical slug generation for imported agencies and personnel.
Source modules should not provide canonical slugs in their packets. If intake
cannot generate a unique slug, the import fails loudly before writing the
affected entity.

Intake maintains durable source mappings by module namespace and stable source
ID. For Minnesota POST agency mappings, the state is shaped like:

```yaml
mn-post:
  agencies:
    <agencyId>:
      agencyId: <agencyId>
      locationPathId: <canonical-location-path-id>
      resolvedImportId: <run-id-that-last-resolved-location>
```

The mapping key is the module-stable agency ID. The `resolvedImportId` points back
to the run artifacts that explain the location resolution inputs and outcome.

## Hydration And Upload

When remote storage is configured, `intake import mn post` hydrates the local
source workspace from remote storage before invoking the module.

After module execution, intake uploads the full source workspace unless
`--no-upload` is set.

For Minnesota POST:

```text
local:  $INTAKE_WORKSPACE/import/mn/post/
remote: s3://$INTAKE_BUCKET/$INTAKE_PREFIX/import/mn/post/
```

Upload sync semantics:

- upload missing files
- skip same-digest files
- fail on remote digest mismatch
- never delete remote files in v1

All local workspace contents are in scope for upload, including state files,
successful runs, no-change runs, and failed runs.

## Module Contract

The main intake CLI dispatches to a configured executable. The initial module
contract should include:

```bash
intake-mn-post metadata
intake-mn-post --command /absolute/path/to/command.yaml
```

For each module invocation, intake writes a `Command` envelope before invoking
the module. The command file is stored inside the command folder so the
invocation input is preserved with the command artifacts.

Example:

```text
$INTAKE_WORKSPACE/intake/commands/import/artifacts/2026-06-07T12-30-00Z-c.../
  c....Command.yaml
```

Initial command file shape:

```yaml
apiVersion: policeconduct.org/intake/v1alpha1
kind: Command
metadata:
  name: c...
  namespace: mn-post
spec:
  path: /absolute/path/to/workspace/intake/commands/import/artifacts/2026-06-07T12-30-00Z-c...
  state:
    path: /absolute/path/to/workspace/intake/state
  logLevel: info
```

Intake creates `spec.state.path` and `spec.path` before invoking the module. The module
must fail if the command file is unreadable, has an unsupported `apiVersion` or
`kind`, names the wrong target namespace, or references paths that do not exist.

The module must write only under the provided `spec.path` and module-approved
state paths.

`spec.state.path` is intake-owned state. Intake-owned canonical source mappings,
including agency location path and slug resolution, remain intake state.

The command file's `kind` determines which module operation runs. In v1, the
required command kind is `Command`.

`metadata` is the module discovery command. It should return YAML that lets
intake verify the configured module before invoking it:

```yaml
displayName: Minnesota POST
version: 0.1.0
jurisdiction: mn
source: post
commands:
  - kind: ImportCommand
    apiVersions:
      - policeconduct.org/intake-module-command/v1alpha1
```

The module returns:

- exit `0` for successful local production, including no-change outcomes
- exit `1` for import or production failure

Intake owns upload and returns:

- exit `0` when import and required upload succeed
- exit `1` when import production fails
- exit `3` when local production succeeds but upload fails

## Security And Operational Notes

`modules.config.yaml` grants code execution authority because intake runs
configured executables. In v1, this is acceptable only when the config is
checked in or deployment-controlled.

Intake does not clone, install, update, or rewrite module repositories in v1.
Installing and updating module executables remains an operator or deployment
responsibility.

Future work may add repository/ref metadata for managed source module checkout,
but that is explicitly out of scope for the first implementation.

## Companion Source Module

The first consumer is the Minnesota POST importer. A companion change in the
MN POST importer repository should implement the module executable contract and
write all state and run artifacts under the intake-provided workspace.
