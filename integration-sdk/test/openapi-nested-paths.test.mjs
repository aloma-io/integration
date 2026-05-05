import { OpenAPIToConnector } from '../build/openapi-to-connector.mjs';

// Simple test framework matching project convention
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m'
};

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    await fn();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

// Minimal OpenAPI spec for testing
const minimalSpec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {}
};

// --- TESTS ---

// Test 1: GET /crm/v3/objects/contacts with opId -> crm.contacts.getPage
await test('nestedPaths: GET /crm/v3/objects/contacts -> crm.contacts.getPage', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });
  assert(typeof generator.deriveMethodPath === 'function', 'deriveMethodPath should be a method on the generator');
  const result = generator.deriveMethodPath('GET', '/crm/v3/objects/contacts', 'get-/crm/v3/objects/contacts_getPage');
  assertEqual(result, 'crm.contacts.getPage');
});

// Test 2: POST /crm/v3/objects/contacts with opId -> crm.contacts.create
await test('nestedPaths: POST /crm/v3/objects/contacts -> crm.contacts.create', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });
  const result = generator.deriveMethodPath('POST', '/crm/v3/objects/contacts', 'post-/crm/v3/objects/contacts_create');
  assertEqual(result, 'crm.contacts.create');
});

// Test 3: Dedup - POST /crm/v3/objects/contacts/merge with opId _merge -> crm.contacts.merge (NOT crm.contacts.merge.merge)
await test('nestedPaths: dedup - POST /crm/v3/objects/contacts/merge -> crm.contacts.merge', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });
  const result = generator.deriveMethodPath('POST', '/crm/v3/objects/contacts/merge', 'post-/crm/v3/objects/contacts/merge_merge');
  assertEqual(result, 'crm.contacts.merge');
});

// Test 4: Batch - POST /crm/v3/objects/contacts/batch/archive -> crm.contacts.batch.archive (NOT duplicated)
await test('nestedPaths: batch - POST /crm/v3/objects/contacts/batch/archive -> crm.contacts.batch.archive', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });
  const result = generator.deriveMethodPath('POST', '/crm/v3/objects/contacts/batch/archive', 'post-/crm/v3/objects/contacts/batch/archive_archive');
  assertEqual(result, 'crm.contacts.batch.archive');
});

// Test 5: Flat mode (nestedPaths: false) -> just getPage (existing behavior unchanged)
await test('flat mode (nestedPaths: false): same input -> just getPage', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: false });
  const result = generator.deriveMethodPath('GET', '/crm/v3/objects/contacts', 'get-/crm/v3/objects/contacts_getPage');
  assertEqual(result, 'getPage');
});

// Test 6: Flat mode with no options (default behavior unchanged)
await test('flat mode (no options): same input -> just getPage', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot');
  const result = generator.deriveMethodPath('GET', '/crm/v3/objects/contacts', 'get-/crm/v3/objects/contacts_getPage');
  assertEqual(result, 'getPage');
});

// --- SUMMARY ---
console.log(`\n${colors.yellow}--- OpenAPI Nested Paths Test Results ---${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  console.log(`\n${colors.red}Some tests failed!${colors.reset}`);
  process.exit(1);
} else {
  console.log(`\n${colors.green}All nested path tests passed!${colors.reset}`);
}
