# Plan

1. `src/cli/acquire/parameter-store-env.ts`: `withParameterStoreSecrets(env, read)` returns an environment whose two token names resolve from Parameter Store on first read and are cached. The default reader runs `aws ssm get-parameter --with-decryption`.
2. Tests in `test/cli/acquire/parameter-store-env.test.ts` with an injected reader: stored value wins, other names pass through, nothing is read until asked, one read per token, an unreadable or empty token throws and names the parameter.
3. `src/cli/acquire/index.ts`: the `acquire` action builds its `env` with `withParameterStoreSecrets(process.env)`.
4. `.env.example`: replace the two token entries with a note.
