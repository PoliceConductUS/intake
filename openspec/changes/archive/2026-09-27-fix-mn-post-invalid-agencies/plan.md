# Plan

Use the existing isolated worktree and Superpowers subagent implementation/review.

1. Add failing regression tests in test/sources/mn-post.test.ts for compact ZIP+4 and leading-zero preservation, retaining valid agency assignments.
2. Add minimal ZIP formatting in sources/mn-post/transform.ts. Run focused tests and live MN transform.
3. Review; run full tests/typecheck/build/OpenSpec checks. Fix any failures.
4. Preserve local baseline and August 14 backup evidence; run data reset --no-acquire. Resolve encountered source failures, audit rebuilt identities/URLs/FKs/status and production omissions.
5. Record results, archive spec, commit.
