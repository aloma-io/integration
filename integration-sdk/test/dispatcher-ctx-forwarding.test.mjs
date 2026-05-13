import { Dispatcher } from '../build/internal/dispatcher/index.mjs';
import { buildResolvers } from '../build/builder/runtime-context.mjs';

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

// Helper: build a dispatcher with given resolvers and execute a query+envelope.
// IMPORTANT: this test passes taskId/namespace/sticky in the envelope to verify the
// dispatcher destructures them and forwards them as a ctx object to handlers.
async function buildAndExecute(resolvers, envelope) {
  const dispatcher = new Dispatcher();
  dispatcher.types({ fields: {} });
  dispatcher.resolvers(resolvers);
  dispatcher.main(async () => {});
  const built = dispatcher.build();
  return built.execute(envelope);
}

// --- RED TESTS for ctx forwarding (SDK v3.8.67 additive change) ---

// Test 1: dispatcher.execute forwards ctx (taskId, namespace, sticky) to a NAMED METHOD handler
//   as the second argument. Currently the dispatcher only passes `variables` — so the second
//   arg is undefined and this test must FAIL (red) until the SDK is patched.
await test('dispatcher forwards ctx as second arg to named-method handler', async () => {
  let receivedArgs;
  let receivedCtx;

  // Use buildResolvers so the wrapper is exercised exactly as it is in production.
  const mockController = {
    myMethod: async (args, ctx) => {
      receivedArgs = args;
      receivedCtx = ctx;
      return { ok: true };
    },
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };
  const methods = ['myMethod', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  await buildAndExecute(resolvers, {
    query: ['myMethod'],
    variables: { foo: 'bar' },
    taskId: 'task-123',
    namespace: 'testing',
    sticky: 'sticky-abc',
  });

  assertEqual(receivedArgs, { foo: 'bar' }, 'args should be forwarded unchanged');
  assert(receivedCtx !== undefined, 'ctx should be defined as second argument');
  assertEqual(receivedCtx.taskId, 'task-123', `ctx.taskId should be "task-123", got ${JSON.stringify(receivedCtx)}`);
  assertEqual(receivedCtx.namespace, 'testing', `ctx.namespace should be "testing", got ${JSON.stringify(receivedCtx)}`);
  assertEqual(receivedCtx.sticky, 'sticky-abc', `ctx.sticky should be "sticky-abc", got ${JSON.stringify(receivedCtx)}`);
});

// Test 2: dispatcher.execute forwards ctx to the __default (fallback) handler as second arg
//   when the named method is not found. Currently the __default invocation only receives the
//   merged variables — so ctx is undefined and this test must FAIL (red) until patched.
await test('dispatcher forwards ctx as second arg to __default fallback handler', async () => {
  let receivedArg;
  let receivedCtx;

  // Resolvers map with ONLY __default — no named methods, so dispatcher falls back.
  const resolvers = {
    __default: async (arg, ctx) => {
      receivedArg = arg;
      receivedCtx = ctx;
      return { fallback: true };
    },
  };

  await buildAndExecute(resolvers, {
    query: ['someUnknownMethod'],
    variables: { hello: 'world' },
    taskId: 'task-456',
    namespace: 'testing',
    sticky: 'sticky-def',
  });

  assert(receivedArg !== undefined, '__default should receive arg');
  assertEqual(receivedArg.hello, 'world', 'variables should be merged into arg');
  assertEqual(receivedArg.__method, ['someUnknownMethod'], '__method should be in arg');
  assert(receivedCtx !== undefined, 'ctx should be defined as second argument to __default');
  assertEqual(receivedCtx.taskId, 'task-456', `ctx.taskId should be "task-456", got ${JSON.stringify(receivedCtx)}`);
  assertEqual(receivedCtx.namespace, 'testing', `ctx.namespace should be "testing"`);
  assertEqual(receivedCtx.sticky, 'sticky-def', `ctx.sticky should be "sticky-def"`);
});

// Test 3: BACKWARD COMPATIBILITY. A controller method with the old 1-arg signature
//   `async myMethod(args)` continues to work when called via the new dispatcher path.
//   The second argument exists but is ignored. This test MUST PASS even in the red phase —
//   if it fails red, the test setup is broken (not the implementation).
await test('one-arg handler still works (backward compatibility)', async () => {
  let receivedArgs;

  const mockController = {
    // Note: only one parameter. Second arg, if any, must be silently ignored.
    legacyMethod: async (args) => {
      receivedArgs = args;
      return { legacy: true, ...args };
    },
    '__autocomplete': async () => ({}),
    '__endpoint': async () => ({}),
    '__default': async () => ({}),
  };
  const methods = ['legacyMethod', '__autocomplete', '__endpoint', '__default'];
  const resolvers = buildResolvers(methods, mockController);

  const result = await buildAndExecute(resolvers, {
    query: ['legacyMethod'],
    variables: { id: 7 },
    taskId: 'task-789',
    namespace: 'testing',
    sticky: 'sticky-ghi',
  });

  assertEqual(receivedArgs, { id: 7 }, 'legacy handler should receive args unchanged');
  assertEqual(result, { legacy: true, id: 7 }, 'legacy handler should return correct result');
});

// --- Results ---
console.log(`\n${colors.yellow}--- Dispatcher ctx forwarding test results ---${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
