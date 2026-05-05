import assert from 'assert';

const { OpenAPIToConnector } = await import('../build/openapi-to-connector.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`✓ PASS: ${name}`); passed++; }
  catch(e) { console.log(`✗ FAIL: ${name} — ${e.message}`); failed++; }
}

const minimalSpec = { openapi: '3.0.0', info: { title: 'Test', version: '1.0' }, paths: {} };
const gen = new OpenAPIToConnector(minimalSpec, 'test', { nestedPaths: true });

// Bug 4: hyphenated path segment must not appear in dotted method path
test('hyphenated path segment sanitised in nested method path', () => {
  const path = gen.deriveMethodPath('PUT',
    '/crm/lists/2025-09/{listId}/memberships/add-and-remove',
    'put-/crm/lists/2025-09/{listId}/memberships/add-and-remove_addAndRemove');
  const segments = path.split('.');
  segments.forEach(seg => {
    assert(!seg.includes('-'), `Method path segment contains hyphen: "${seg}" in "${path}"`);
  });
});

// Bug 4: path with object-type-id (hyphenated) must produce clean segments
test('object-type-id hyphenated path sanitised to camelCase', () => {
  const path = gen.deriveMethodPath('GET',
    '/crm/lists/2025-09/object-type-id/{objectTypeId}/name/{listName}',
    'get-/crm/lists/2025-09/object-type-id/{objectTypeId}/name/{listName}_getByName');
  const segments = path.split('.');
  segments.forEach(seg => {
    assert(!seg.includes('-'), `Method path segment contains hyphen: "${seg}" in "${path}"`);
  });
});

// Bug 5: operationId suffix that IS a raw URL path must not duplicate the full path
test('raw URL suffix does not produce duplicated path in method name', () => {
  const path = gen.deriveMethodPath('GET',
    '/crm/lists/2025-09',
    'get-/crm/lists/2025-09_/crm/lists/2025-09');
  // Should be short and clean, not a duplicated path
  assert(path.length < 40, `Path too long (duplication): "${path}" (${path.length} chars)`);
  assert(!path.includes('_'), `Path contains underscores (non-nested fallback used): "${path}"`);
});

// Bug 5: same duplication test for the batch/read endpoint
test('batch/read raw URL suffix does not produce duplicated path', () => {
  const path = gen.deriveMethodPath('POST',
    '/crm/lists/2025-09/records/memberships/batch/read',
    'post-/crm/lists/2025-09/records/memberships/batch/read_/crm/lists/2025-09/records/memberships/batch/read');
  assert(path.length < 60, `Path too long (duplication): "${path}" (${path.length} chars)`);
  assert(!path.includes('_'), `Path contains underscores (non-nested fallback used): "${path}"`);
});

// Bug 4: generateMethodName fallback (no operationId) must sanitise hyphens
test('generateMethodName fallback sanitises hyphens to camelCase', () => {
  const name = gen.generateMethodName({
    method: 'PUT',
    path: '/crm/lists/2025-09/folders/move-list',
    operationId: undefined
  });
  assert(!name.includes('-'), `Fallback name contains hyphen: "${name}"`);
  assert(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name), `Not a valid identifier: "${name}"`);
});

console.log(`\n${passed} passing / ${failed} failing`);
if (failed > 0) process.exit(1);
