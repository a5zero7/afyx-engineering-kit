/**
 * Which files are tests, and which merely are not production code.
 *
 * `isTestPath` is the narrow reading: naming and directory conventions of real test
 * suites. `isTestFile` is the wide reading used for ranking: also examples, samples,
 * benchmarks, fixtures and demos, none of which a code search is normally after.
 * Both are pure functions of the path string.
 */

import * as nodePath from 'path';

// ---- file-name conventions ------------------------------------------------------

// test_foo.py, test.js, foo_test.go, foo.test.ts, bar-spec.rb (on the lowercased name)
const LOWERCASE_NAME_RULE = /^test[_.]|[._-](?:test|tests|spec|specs)\.[a-z0-9]+$/;

// Capital-led CamelCase suffixes (FooTest.kt, BazSpec.scala); "latest.kt" must not match.
const CAMEL_NAME_RULE = /(?:Test|Tests|TestCase|Tester|Spec|Specs)\.[A-Za-z0-9]+$/;

// ---- directory conventions ------------------------------------------------------

const NESTED_TEST_DIR = /\/(?:tests|test|__tests__|spec|specs|testlib|testing|e2e)\//;
const ROOT_TEST_DIR = /^(?:test|tests|spec|specs|e2e)\//;

// Kotlin/Gradle/Xcode source sets such as jvmTest/, commonTest/, integrationTest/.
const CAMEL_TEST_SOURCE_SET = /(?:^|\/)[A-Za-z0-9]*(?:Test|Tests|Spec)\//;
// Test-support modules and doubles: data-test/, testdata/, testutils/, fakes/, mocks/, __mocks__/, stubs/.
const SUPPORT_DIR = /(?:^|\/)(?:[\w.]+[-_]test(?:s|ing)?|testdata|testutils?|test[-_]utils?|fakes?|mocks?|__mocks__|stubs)\//;

export function isTestPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const name = nodePath.basename(filePath);

  if (LOWERCASE_NAME_RULE.test(name.toLowerCase()) || CAMEL_NAME_RULE.test(name)) return true;
  if (NESTED_TEST_DIR.test(lower) || ROOT_TEST_DIR.test(lower)) return true;
  return CAMEL_TEST_SOURCE_SET.test(filePath) || SUPPORT_DIR.test(lower);
}

// ---- non-production directories ---------------------------------------------------

const NON_PRODUCTION_DIR = /(?:^|\/)(?:integration|samples?|examples?|fixtures?|benchmarks?|demos?)\//;

/**
 * Only the layout above a `src/` directory counts: a package path below it
 * (`…/src/main/kotlin/com/acme/samples/…`) is production code by layout.
 */
function layoutAboveSource(lowerPath: string): string {
  const source = lowerPath.indexOf('/src/');
  if (source >= 0) return lowerPath.slice(0, source + 1);
  return lowerPath.startsWith('src/') ? '' : lowerPath;
}

export function isTestFile(filePath: string): boolean {
  return isTestPath(filePath) || NON_PRODUCTION_DIR.test(layoutAboveSource(filePath.toLowerCase()));
}
