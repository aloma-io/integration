import { Dispatcher } from '../build/internal/dispatcher/index.mjs';

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Helper: build a dispatcher with given resolvers and execute a query
async function buildAndExecute(resolvers, query, variables) {
  const dispatcher = new Dispatcher();
  dispatcher.types({ fields: {} });
  dispatcher.resolvers(resolvers);
  dispatcher.main(async () => {});
  const built = dispatcher.build();
  return built.execute({ query, variables });
}

// --- TESTS ---

// Test 1: Dispatcher correctly resolves pre-built nested structures (baseline)
await test('Dispatcher resolves pre-built nested structure (baseline)', async () => {
  const handler = async (args) => ({ created: true, ...args });
  const resolvers = { crm: { contacts: { create: handler } } };
  const result = await buildAndExecute(resolvers, ['crm', 'contacts', 'create'], { name: 'test' });
  assertEqual(result, { created: true, name: 'test' });
});

// Test 2: Dispatcher resolves flat keys (baseline)
await test('Dispatcher resolves flat key (baseline)', async () => {
  const handler = async (args) => ({ flat: true, ...args });
  const resolvers = { contactsCreate: handler };
  const result = await buildAndExecute(resolvers, ['contactsCreate'], { id: 1 });
  assertEqual(result, { flat: true, id: 1 });
});

// Test 3: CRITICAL — import buildResolvers from runtime-context and verify it
// handles dotted method names by creating nested structures.
// This is the RED test: buildResolvers doesn't exist yet.
await test('buildResolvers creates nested structure for dotted method names', async () => {
  const { buildResolvers } = await import('../build/builder/runtime-context.mjs');

  assert(typeof buildResolvers === 'function', 'buildResolvers should be exported from runtime-context');

  const mockController = {
    'crm.contacts.create': async (args) => ({ method: 'crm.contacts.create', ...args }),
    'crm.contacts.list': async (args) => ({ method: 'crm.contacts.list', ...args }),
    'flatMethod': async (args) => ({ method: 'flatMethod', ...args }),
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };

  const methods = ['crm.contacts.create', 'crm.contacts.list', 'flatMethod', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  // Nested structure for dotted names
  assert(resolvers.crm, 'resolvers.crm should exist');
  assert(resolvers.crm.contacts, 'resolvers.crm.contacts should exist');
  assert(typeof resolvers.crm.contacts.create === 'function', 'crm.contacts.create should be a function');
  assert(typeof resolvers.crm.contacts.list === 'function', 'crm.contacts.list should be a function');

  // Flat structure for non-dotted names
  assert(typeof resolvers.flatMethod === 'function', 'flatMethod should be a function');
  assert(typeof resolvers.__autocomplete === 'function', '__autocomplete should be a function');
  assert(typeof resolvers.__endpoint === 'function', '__endpoint should be a function');
  assert(typeof resolvers.__default === 'function', '__default should be a function');
});

// Test 4: buildResolvers nested methods resolve correctly through dispatcher
await test('buildResolvers nested methods resolve through dispatcher end-to-end', async () => {
  const { buildResolvers } = await import('../build/builder/runtime-context.mjs');

  const mockController = {
    'crm.contacts.create': async (args) => ({ created: true, ...(args || {}) }),
    'crm.contacts.list': async () => ({ items: ['a', 'b'] }),
    'flatMethod': async (args) => ({ flat: true, ...(args || {}) }),
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };

  const methods = ['crm.contacts.create', 'crm.contacts.list', 'flatMethod', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  // Execute through dispatcher
  const nestedResult = await buildAndExecute(resolvers, ['crm', 'contacts', 'create'], { name: 'Acme' });
  assertEqual(nestedResult, { created: true, name: 'Acme' });

  const listResult = await buildAndExecute(resolvers, ['crm', 'contacts', 'list'], {});
  assertEqual(listResult, { items: ['a', 'b'] });

  const flatResult = await buildAndExecute(resolvers, ['flatMethod'], { x: 42 });
  assertEqual(flatResult, { flat: true, x: 42 });
});

// Test 5: buildResolvers preserves existing flat registration for non-dotted names
await test('buildResolvers flat names are unchanged (backward compat)', async () => {
  const { buildResolvers } = await import('../build/builder/runtime-context.mjs');

  const mockController = {
    'simpleMethodA': async () => ({ a: true }),
    'simpleMethodB': async () => ({ b: true }),
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };

  const methods = ['simpleMethodA', 'simpleMethodB', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  // All flat — no nested structures
  assert(typeof resolvers.simpleMethodA === 'function', 'simpleMethodA should be a function');
  assert(typeof resolvers.simpleMethodB === 'function', 'simpleMethodB should be a function');

  const resultA = await buildAndExecute(resolvers, ['simpleMethodA'], {});
  assertEqual(resultA, { a: true });

  const resultB = await buildAndExecute(resolvers, ['simpleMethodB'], {});
  assertEqual(resultB, { b: true });
});

// Test 6: Nested and flat coexist without overwriting each other
await test('buildResolvers nested and flat coexist without conflicts', async () => {
  const { buildResolvers } = await import('../build/builder/runtime-context.mjs');

  const mockController = {
    'crm.contacts.create': async () => ({ source: 'nested' }),
    'contactsCreate': async () => ({ source: 'flat' }),
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };

  const methods = ['crm.contacts.create', 'contactsCreate', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  const nestedResult = await buildAndExecute(resolvers, ['crm', 'contacts', 'create'], {});
  assertEqual(nestedResult, { source: 'nested' });

  const flatResult = await buildAndExecute(resolvers, ['contactsCreate'], {});
  assertEqual(flatResult, { source: 'flat' });
});

// --- SUMMARY ---
console.log(`\n${colors.yellow}📊 Nested Resolver Test Results:${colors.reset}`);
console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  console.log(`\n${colors.red}❌ Some tests failed!${colors.reset}`);
  process.exit(1);
} else {
  console.log(`\n${colors.green}🎉 All nested resolver tests passed!${colors.reset}`);
}
