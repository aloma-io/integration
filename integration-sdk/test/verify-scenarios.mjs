import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAPIToConnector } from '../build/openapi-to-connector.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m'
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    fn();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function expect(actual) {
  return {
    toEqual: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected:\n${expected.slice(0, 200)}...\n\nActual:\n${actual.slice(0, 200)}...`);
      }
    },
    toInclude: (expected) => {
      if (!actual.includes(expected)) {
        throw new Error(`Expected output to include: "${expected}"\n\nActual output snippet: "${actual.slice(0, 500)}..."`);
      }
    },
    toNotInclude: (expected) => {
      if (actual.includes(expected)) {
        throw new Error(`Expected output to NOT include: "${expected}"\n\nBut it was found in the output.`);
      }
    }
  };
}

// Helper function to normalize output
const normalizeOutput = (output) => output
  .replace(/\r\n/g, '\n')
  .trim();

console.log(`${colors.yellow}🧪 Running Scenario Fixture Tests${colors.reset}\n`);

// Test 1: Simple Scenario
test('Simple Scenario - should generate expected output', () => {
  // Read input spec
  const specPath = path.join(__dirname, 'scenarios/simple/simple-api.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  // Read expected output
  const expectedPath = path.join(__dirname, 'scenarios/simple/expected-controller.mts');
  const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
  
  // Generate actual output
  const generator = new OpenAPIToConnector(spec, 'simple-test');
  const actualOutput = generator.generateController();
  
  // Compare outputs
  expect(normalizeOutput(actualOutput)).toEqual(normalizeOutput(expectedOutput));
});

// Test 2: Simple Scenario - Methods without options
test('Simple Scenario - methods without options should be clean', () => {
  const specPath = path.join(__dirname, 'scenarios/simple/simple-api.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  const generator = new OpenAPIToConnector(spec, 'simple-test');
  const actualOutput = generator.generateController();
  
  expect(actualOutput).toInclude('async getProducts() {');
  expect(actualOutput).toInclude('async createProduct(options:');
});

// Test 3: Complex Scenario - Main Controller
test('Complex Scenario - main controller should generate expected output', () => {
  const productsSpecPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
  const ordersSpecPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
  const productsSpecContent = fs.readFileSync(productsSpecPath, 'utf-8');
  const ordersSpecContent = fs.readFileSync(ordersSpecPath, 'utf-8');
  
  const productsSpec = OpenAPIToConnector.parseSpec(productsSpecContent);
  const ordersSpec = OpenAPIToConnector.parseSpec(ordersSpecContent);
  
  const expectedPath = path.join(__dirname, 'scenarios/complex/expected/controller.mts');
  const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
  
  const resources = [
    { className: 'ProductsResource', fileName: 'products' },
    { className: 'OrdersResource', fileName: 'orders' }
  ];
  const resourceSpecs = [
    { fileName: 'products', spec: productsSpec },
    { fileName: 'orders', spec: ordersSpec }
  ];
  
  const mainGenerator = new OpenAPIToConnector(productsSpec, 'test-shop-temp');
  const actualOutput = mainGenerator.generateMainController(resources, resourceSpecs);
  
  expect(normalizeOutput(actualOutput)).toEqual(normalizeOutput(expectedOutput));
});

// Test 4: Complex Scenario - Products Resource
test('Complex Scenario - products resource should generate expected output', () => {
  const specPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  const expectedPath = path.join(__dirname, 'scenarios/complex/expected/products-resource.mts');
  const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
  
  const generator = new OpenAPIToConnector(spec, 'test-shop');
  const actualOutput = generator.generateResourceClass('ProductsResource');
  
  expect(normalizeOutput(actualOutput)).toEqual(normalizeOutput(expectedOutput));
});

// Test 5: Complex Scenario - Orders Resource
test('Complex Scenario - orders resource should generate expected output', () => {
  const specPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  const expectedPath = path.join(__dirname, 'scenarios/complex/expected/orders-resource.mts');
  const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
  
  const generator = new OpenAPIToConnector(spec, 'test-shop');
  const actualOutput = generator.generateResourceClass('OrdersResource');
  
  expect(normalizeOutput(actualOutput)).toEqual(normalizeOutput(expectedOutput));
});

// Test 6: TypeScript Interface Generation
test('TypeScript interfaces should be generated correctly', () => {
  const specPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  const generator = new OpenAPIToConnector(spec, 'test-shop');
  const actualOutput = generator.generateResourceClass('ProductsResource');
  
  expect(actualOutput).toInclude('export interface Product {');
  expect(actualOutput).toInclude('export interface ProductList {');
  expect(actualOutput).toInclude('export interface CreateProductRequest {');
  expect(actualOutput).toInclude('Promise<ProductList>');
  expect(actualOutput).toInclude('Promise<Product>');
});

// Test 7: Path Parameters and Options
test('Path parameters and options should be handled correctly', () => {
  const specPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const spec = OpenAPIToConnector.parseSpec(specContent);
  
  const generator = new OpenAPIToConnector(spec, 'test-shop');
  const actualOutput = generator.generateResourceClass('OrdersResource');
  
  expect(actualOutput).toInclude('export function getOrder(this: any, orderId: string)');
  expect(actualOutput).toInclude('export function updateOrderStatus(this: any, orderId: string, options');
  expect(actualOutput).toInclude('export function cancelOrder(this: any, orderId: string)');
});

// Test 8: Exposed Methods in Main Controller
test('Exposed methods should be present in main controller', () => {
  const productsSpecPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
  const ordersSpecPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
  const productsSpecContent = fs.readFileSync(productsSpecPath, 'utf-8');
  const ordersSpecContent = fs.readFileSync(ordersSpecPath, 'utf-8');
  
  const productsSpec = OpenAPIToConnector.parseSpec(productsSpecContent);
  const ordersSpec = OpenAPIToConnector.parseSpec(ordersSpecContent);
  
  const resources = [
    { className: 'ProductsResource', fileName: 'products' },
    { className: 'OrdersResource', fileName: 'orders' }
  ];
  const resourceSpecs = [
    { fileName: 'products', spec: productsSpec },
    { fileName: 'orders', spec: ordersSpec }
  ];
  
  const mainGenerator = new OpenAPIToConnector(productsSpec, 'test-shop');
  const actualOutput = mainGenerator.generateMainController(resources, resourceSpecs);
  
  expect(actualOutput).toInclude('async productsGetProducts(');
  expect(actualOutput).toInclude('async productsCreateProduct(');
  expect(actualOutput).toInclude('async productsGetProduct(');
  expect(actualOutput).toInclude('async productsUpdateProduct(');
  expect(actualOutput).toInclude('async productsDeleteProduct(');
  
  expect(actualOutput).toInclude('async ordersGetOrders(');
  expect(actualOutput).toInclude('async ordersCreateOrder(');
  expect(actualOutput).toInclude('async ordersGetOrder(');
  expect(actualOutput).toInclude('async ordersUpdateOrderStatus(');
  expect(actualOutput).toInclude('async ordersCancelOrder(');
  
  expect(actualOutput).toInclude('this.bindResourceFunctions(\'products\', productsFunctions);');
  expect(actualOutput).toInclude('this.bindResourceFunctions(\'orders\', ordersFunctions);');
});

// Test 9: Schema Name Sanitization
test('Schema names should be sanitized correctly', () => {
  const testSpec = {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: {
      '/test': {
        get: {
          operationId: 'testOperation',
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    '$ref': '#/components/schemas/Complex.Name.With.Dots'
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        'Complex.Name.With.Dots': {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' }
          }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(testSpec, 'test');
  const output = generator.generateController();
  
  expect(output).toInclude('export interface Complex_Name_With_Dots {');
  expect(output).toNotInclude('export interface Complex.Name.With.Dots {');
  expect(output).toInclude('Promise<Complex_Name_With_Dots>');
});

// Test 10: No Options Parameter for Simple Methods
test('Simple methods should not have options parameter', () => {
  const simpleSpec = {
    openapi: '3.0.0',
    info: { title: 'Simple API', version: '1.0.0' },
    paths: {
      '/simple': {
        get: {
          operationId: 'getSimple',
          responses: { '200': { description: 'Success' } }
        }
      }
    }
  };

  const generator = new OpenAPIToConnector(simpleSpec, 'test');
  const output = generator.generateController();
  
  expect(output).toInclude('async getSimple() {');
  expect(output).toNotInclude('options = options || {}');
  expect(output).toNotInclude('headers: options');
});

// Print final results
console.log(`${colors.yellow}📊 Test Results:${colors.reset}`);
console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);

if (failed === 0) {
  console.log(`\n${colors.green}🎉 All tests passed!${colors.reset}`);
  process.exit(0);
} else {
  console.log(`\n${colors.red}❌ Some tests failed!${colors.reset}`);
  process.exit(1);
}