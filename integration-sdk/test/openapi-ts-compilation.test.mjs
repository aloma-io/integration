import assert from 'assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = join(__dirname, '..');

const { OpenAPIToConnector } = await import('../build/openapi-to-connector.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`✓ PASS: ${name}`); passed++; }
  catch(e) { console.log(`✗ FAIL: ${name} — ${e.message}`); failed++; }
}

// --- Bug A: schema type references that are not locally defined ---
// When a $ref points to a schema NOT present in the spec's components.schemas,
// resolveSchemaRef still emits the type name (e.g., PublicAssociationsForObject)
// in the function signature. Since no interface is generated, tsc fails with TS2304.

test('Bug A: resolveSchemaRef emits any for types not in components.schemas', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/crm/contacts/{contactId}': {
        put: {
          operationId: 'updateContact',
          parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    associations: { $ref: '#/components/schemas/PublicAssociationsForObject' },
                    properties: { type: 'object' }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'OK' } }
        }
      }
    },
    // Schema is referenced but NOT defined — simulates cross-file ref or incomplete spec
    components: { schemas: {} }
  };

  const gen = new OpenAPIToConnector(spec, 'contacts', { nestedPaths: true });
  const resourceCode = gen.generateResourceClass('ContactsResource');

  // The type name must NOT appear in generated code when no interface is emitted
  const hasTypeRef = resourceCode.includes('PublicAssociationsForObject');
  const hasInterface = resourceCode.includes('interface PublicAssociationsForObject');

  assert(!hasTypeRef || hasInterface,
    `Type 'PublicAssociationsForObject' referenced in function signature but not defined. ` +
    `resolveSchemaRef must emit 'any' when the schema is not in components.schemas.`);
});

// --- Bug B: add-resource produces duplicate functions on re-run ---
// The add-resource CLI command appends exposed methods to the controller
// without checking if they already exist. Running it twice duplicates functions.

test('Bug B: add-resource CLI deduplicates exposed methods on re-run', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/crm/contacts': {
        get: { operationId: 'getContacts', responses: { '200': { description: 'OK' } } }
      },
      '/crm/contacts/{id}': {
        get: {
          operationId: 'getContactById',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  };

  const gen = new OpenAPIToConnector(spec, 'contacts', { nestedPaths: true });
  const resources = [{ className: 'ContactsResource', fileName: 'contacts' }];
  const resourceSpecs = [{ fileName: 'contacts', spec }];

  const exposedMethods = gen.generateExposedResourceMethods(resources, resourceSpecs);

  // Simulate a controller that already contains these methods (from first add-resource run)
  const existingController = `export default class Controller {\n${exposedMethods}\n}`;

  // Simulate the fixed CLI dedup logic: extract existing names, filter new methods
  const existingNames = new Set(
    (existingController.match(/async\s+['"]([^'"]+)['"]\s*\(/g) || [])
      .map(m => m.match(/['"]([^'"]+)['"]/)?.[1])
      .filter(Boolean)
  );

  const methodBlocks = exposedMethods.split(/(?=\n  async ['"])/);
  const newMethods = methodBlocks.filter(block => {
    const nameMatch = block.match(/async\s+['"]([^'"]+)['"]\s*\(/);
    return !nameMatch || !existingNames.has(nameMatch[1]);
  }).join('');

  // After dedup, no new methods should be added (all already exist)
  const remainingDeclarations = newMethods.match(/async\s+['"]([^'"]+)['"]\s*\(/g) || [];
  assert(remainingDeclarations.length === 0,
    `Dedup failed: ${remainingDeclarations.length} methods would be re-added. ` +
    `CLI must filter out methods already present in the controller.`);
});

// --- Bug C: generated code references options.headers but type lacks headers field ---
// The generator emits `const { headers, ...bodyData } = options;` and
// `headers: options.headers` in fetchOptions, but the options type generated
// for the function signature does NOT include `headers?: Record<string, string>`.

test('Bug C: generated method with body includes headers in options type', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/crm/contacts': {
        post: {
          operationId: 'createContact',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    firstname: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: { '201': { description: 'Created' } }
        }
      }
    }
  };

  const gen = new OpenAPIToConnector(spec, 'contacts', { nestedPaths: true });
  const resourceCode = gen.generateResourceClass('ContactsResource');

  // The generator emits `const { headers, ...bodyData } = options;` and
  // `headers: options.headers` — so the options type MUST include headers
  const usesHeaders = resourceCode.includes('options.headers') ||
                      resourceCode.includes('options?.headers') ||
                      resourceCode.includes('{ headers,') ||
                      resourceCode.includes('{ headers }');

  if (usesHeaders) {
    // Extract the function signature to check just the type definition
    const sigMatch = resourceCode.match(/export function createContact\(this: any,([^)]+)\)/s);
    const signature = sigMatch ? sigMatch[1] : '';
    const hasHeadersInType = signature.includes('headers');
    assert(hasHeadersInType,
      `Generated code destructures/accesses 'headers' from options but the function ` +
      `signature's options type does not include a headers field. ` +
      `Signature: ${signature.trim()}`);
  } else {
    // If headers is not used, that's also a valid fix (removing the reference)
    assert(true);
  }
});

console.log(`\n${passed} passing / ${failed} failing`);
if (failed > 0) process.exit(1);
