- [x] Reproduce the undeclared manual coverage output with a regression test.
- [x] Add the two missing handled kinds.
- [x] Verify manual tests, actual transform, and OpenSpec validation.

Verification: regression failed on the missing declaration before the fix; 13 manual tests pass. Actual workspace manual transform succeeds. OpenSpec: 51 passed. git diff --check passes.
