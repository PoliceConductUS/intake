# Personnel portraits

Import a local portrait for an exact existing personnel ID:

```sh
INTAKE_WORKSPACE=/path/to/workspace npm run cli -- photo import PERSONNEL_ID /path/to/photo.webp
```

Use `--source-url URL` only when a verified source URL is known. Intake retains the original filename and stores the bytes by SHA-256 under `assets/PersonnelPhoto/` in that workspace. The command appends a typed record to the existing manual source; it does not change database rows.

Apply the record through the shared source pipeline:

```sh
npm run cli -- data transform org.policeconduct.manual
npm run cli -- data generate org.policeconduct.manual
npm run cli -- data up
```

Set the same `INTAKE_WORKSPACE` for each command and for website builds. Inspect the generated mutation chain before applying when other changes are pending. Reimporting for the same personnel compares the supplied photo fields and produces an update when bytes or provenance change. Keep workspace assets and the identity/mutation ledgers together when backing up or moving the workspace.
