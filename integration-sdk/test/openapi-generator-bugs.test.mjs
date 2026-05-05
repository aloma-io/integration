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

// === BUG 1: Duplicate function names within a resource ===

await test('Bug1: Two ops producing same method name are deduplicated in resource output', async () => {
  // Spec with two operations that both derive "archive" as method name:
  // POST /batch/archive -> operationId batch_archive (suffix: archive)
  // DELETE /contacts/{id} -> operationId contacts_archive (suffix: archive)
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/contacts/batch/archive': {
        post: {
          operationId: 'batch_archive',
          summary: 'Batch archive contacts',
          responses: { '200': { description: 'OK' } }
        }
      },
      '/contacts/{contactId}': {
        delete: {
          operationId: 'contacts_archive',
          summary: 'Archive single contact',
          parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Deleted' } }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(spec, 'test', { nestedPaths: false });
  const output = generator.generateResourceClass('ContactsResource');

  // Count how many times "export function archive(" appears
  const matches = output.match(/export function archive\(/g);
  assert(
    !matches || matches.length <= 1,
    `Expected at most 1 "export function archive(" but found ${matches ? matches.length : 0}. Duplicate function names!`
  );

  // There should be two distinct function declarations (disambiguated)
  const funcDecls = output.match(/export function \w+\(/g);
  assert(funcDecls && funcDecls.length >= 2, `Expected at least 2 distinct function declarations, got ${funcDecls ? funcDecls.length : 0}`);
});

await test('Bug1: generateController with colliding method names produces distinct methods', async () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/items/batch/read': {
        post: {
          operationId: 'batch_read',
          summary: 'Batch read items',
          responses: { '200': { description: 'OK' } }
        }
      },
      '/items/{itemId}': {
        get: {
          operationId: 'items_read',
          summary: 'Read single item',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(spec, 'test', { nestedPaths: false });
  const output = generator.generateController();

  // Count occurrences of "async read(" — should be at most 1
  const matches = output.match(/async read\(/g);
  assert(
    !matches || matches.length <= 1,
    `Expected at most 1 "async read(" but found ${matches ? matches.length : 0}. Duplicate method names in controller!`
  );
});

// === BUG 2: Dead code after return ===

await test('Bug2: Resource function for simple path+params has no statements after return', async () => {
  // A simple GET with path param and no query/body triggers the "isSimple" branch
  // which already emits a return, but then the code unconditionally appends another return
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/contacts/{contactId}': {
        get: {
          operationId: 'getContact',
          summary: 'Get a contact',
          parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(spec, 'test', { nestedPaths: false });
  const output = generator.generateResourceClass('ContactsResource');

  // Extract the function body for getContact
  const funcMatch = output.match(/export function getContact[\s\S]*?\n\}/);
  assert(funcMatch, 'Could not find getContact function in output');
  const funcBody = funcMatch[0];

  // Find all return statements
  const returnStatements = funcBody.match(/return this\.api\.fetch/g);
  assert(
    returnStatements && returnStatements.length === 1,
    `Expected exactly 1 return statement but found ${returnStatements ? returnStatements.length : 0}. Dead code after return!`
  );
});

await test('Bug2: Controller function for simple path+params has no dead code after return', async () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/items/{itemId}': {
        get: {
          operationId: 'getItem',
          summary: 'Get an item',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(spec, 'test', { nestedPaths: false });
  const output = generator.generateController();

  // Extract the method body for getItem
  const methodMatch = output.match(/async getItem[\s\S]*?\n  \}/);
  assert(methodMatch, 'Could not find getItem method in output');
  const methodBody = methodMatch[0];

  // Find all return statements
  const returnStatements = methodBody.match(/return this\.api\.fetch/g);
  assert(
    returnStatements && returnStatements.length === 1,
    `Expected exactly 1 return statement but found ${returnStatements ? returnStatements.length : 0}. Dead code after return in controller!`
  );
});

// === BUG 3: Raw URL path segments in method names ===

await test('Bug3: deriveMethodPath handles operationId with raw URL paths (lists style)', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });

  // HubSpot lists-style operationId: "get-/crm/v3/lists_/crm/v3/lists"
  const result = generator.deriveMethodPath('GET', '/crm/v3/lists', 'get-/crm/v3/lists_/crm/v3/lists');

  // Should NOT contain slashes or version numbers
  assert(!result.includes('/'), `Method path should not contain slashes, got: "${result}"`);
  assert(!result.includes('v3'), `Method path should not contain version numbers, got: "${result}"`);
});

await test('Bug3: deriveMethodPath handles operationId suffix that IS a raw URL path', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });

  // operationId: "post-/crm/v3/lists/search_/crm/v3/lists/search"
  const result = generator.deriveMethodPath('POST', '/crm/v3/lists/search', 'post-/crm/v3/lists/search_/crm/v3/lists/search');

  assert(!result.includes('/'), `Method path should not contain slashes, got: "${result}"`);
  assert(!result.includes('v3'), `Method path should not contain version numbers, got: "${result}"`);
  // Should contain "lists" and "search" in some form
  assert(result.includes('lists'), `Method path should contain "lists", got: "${result}"`);
  assert(result.includes('search'), `Method path should contain "search", got: "${result}"`);
});

await test('Bug3: deriveMethodPath does not produce doubled segments from URL-style operationId', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: true });

  // operationId: "put-/crm/v3/lists/{listId}/restore_/crm/v3/lists/{listId}/restore"
  const result = generator.deriveMethodPath('PUT', '/crm/v3/lists/{listId}/restore', 'put-/crm/v3/lists/{listId}/restore_/crm/v3/lists/{listId}/restore');

  assert(!result.includes('/'), `Method path should not contain slashes, got: "${result}"`);
  // Should not have doubled path segments like "lists.lists" or "restore.restore"
  const parts = result.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    assert(parts[i] !== parts[i + 1], `Doubled segment "${parts[i]}" in method path: "${result}"`);
  }
});

await test('Bug3: generateMethodName (flat mode) cleans operationId with raw URL paths', async () => {
  const generator = new OpenAPIToConnector(minimalSpec, 'hubspot', { nestedPaths: false });

  // When nestedPaths is false, deriveMethodPath calls generateMethodName
  // This should still produce a clean identifier without slashes
  const result = generator.deriveMethodPath('GET', '/crm/v3/lists', 'get-/crm/v3/lists_/crm/v3/lists');

  assert(!result.includes('/'), `Flat method name should not contain slashes, got: "${result}"`);
  assert(/^[a-zA-Z_]/.test(result), `Method name should start with letter or underscore, got: "${result}"`);
});

// --- Report ---
console.log(`\n${colors.yellow}===== Results =====${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
