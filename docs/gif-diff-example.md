=== RUN TESTS ===
FAIL src/foo.spec.ts
  ✕ returns 42 (15 ms)
  ● ReferenceError: x is not defined
    at src/foo.ts:17:9

PASS src/bar.spec.ts
Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 8 passed, 9 total
Time:        2.12 s

diff --git a/src/foo.ts b/src/foo.ts
index a1b2..c3d4 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,3 +10,4 @@ export function foo() {
-  return x + 1
+  const x = 41
+  return x + 1
}
