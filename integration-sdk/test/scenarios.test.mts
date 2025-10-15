import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAPIToConnector } from '../build/openapi-to-connector.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Scenario Tests - Full Code Generation', () => {
  
  describe('Simple Scenario (single controller)', () => {
    it('should generate exact expected output for simple-api.json', () => {
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
      
      // Compare outputs (normalize line endings)
      const normalizeOutput = (output: string) => output
        .replace(/\r\n/g, '\n')
        .trim();
      
      expect(normalizeOutput(actualOutput)).to.equal(normalizeOutput(expectedOutput));
    });

    it('should correctly handle methods without options', () => {
      // Read input spec
      const specPath = path.join(__dirname, 'scenarios/simple/simple-api.json');
      const specContent = fs.readFileSync(specPath, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);
      
      // Generate actual output
      const generator = new OpenAPIToConnector(spec, 'simple-test');
      const actualOutput = generator.generateController();
      
      // Verify methods without options don't have unnecessary code
      expect(actualOutput).to.include('async getProducts() {'); // No options parameter
      expect(actualOutput).to.not.include('options = options || {}'); // No options initialization for getProducts
      expect(actualOutput).to.include('async createProduct(options:'); // Has options parameter
      expect(actualOutput).to.include('options = options || {};'); // Has options initialization for createProduct
    });
  });

  describe('Complex Scenario (multi-resource)', () => {
    it('should generate exact expected main controller output', () => {
      // Read input specs
      const productsSpecPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
      const ordersSpecPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
      const productsSpecContent = fs.readFileSync(productsSpecPath, 'utf-8');
      const ordersSpecContent = fs.readFileSync(ordersSpecPath, 'utf-8');
      
      const productsSpec = OpenAPIToConnector.parseSpec(productsSpecContent);
      const ordersSpec = OpenAPIToConnector.parseSpec(ordersSpecContent);
      
      // Read expected output
      const expectedPath = path.join(__dirname, 'scenarios/complex/expected/controller.mts');
      const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
      
      // Generate actual output
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
      
      // Compare outputs (normalize line endings)
      const normalizeOutput = (output: string) => output
        .replace(/\r\n/g, '\n')
        .trim();
      
      expect(normalizeOutput(actualOutput)).to.equal(normalizeOutput(expectedOutput));
    });

    it('should generate exact expected products resource output', () => {
      // Read input spec
      const specPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
      const specContent = fs.readFileSync(specPath, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);
      
      // Read expected output
      const expectedPath = path.join(__dirname, 'scenarios/complex/expected/products-resource.mts');
      const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
      
      // Generate actual output
      const generator = new OpenAPIToConnector(spec, 'test-shop');
      const actualOutput = generator.generateResourceClass('ProductsResource');
      
      // Compare outputs (normalize line endings)
      const normalizeOutput = (output: string) => output
        .replace(/\r\n/g, '\n')
        .trim();
      
      expect(normalizeOutput(actualOutput)).to.equal(normalizeOutput(expectedOutput));
    });

    it('should generate exact expected orders resource output', () => {
      // Read input spec
      const specPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
      const specContent = fs.readFileSync(specPath, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);
      
      // Read expected output
      const expectedPath = path.join(__dirname, 'scenarios/complex/expected/orders-resource.mts');
      const expectedOutput = fs.readFileSync(expectedPath, 'utf-8');
      
      // Generate actual output
      const generator = new OpenAPIToConnector(spec, 'test-shop');
      const actualOutput = generator.generateResourceClass('OrdersResource');
      
      // Compare outputs (normalize line endings)
      const normalizeOutput = (output: string) => output
        .replace(/\r\n/g, '\n')
        .trim();
      
      expect(normalizeOutput(actualOutput)).to.equal(normalizeOutput(expectedOutput));
    });

    it('should correctly handle TypeScript interface generation', () => {
      // Read products spec
      const specPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
      const specContent = fs.readFileSync(specPath, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);
      
      // Generate output
      const generator = new OpenAPIToConnector(spec, 'test-shop');
      const actualOutput = generator.generateResourceClass('ProductsResource');
      
      // Verify TypeScript interfaces are generated correctly
      expect(actualOutput).to.include('export interface Product {');
      expect(actualOutput).to.include('export interface ProductList {');
      expect(actualOutput).to.include('export interface CreateProductRequest {');
      expect(actualOutput).to.include('export interface UpdateProductRequest {');
      
      // Verify proper TypeScript types in method signatures
      expect(actualOutput).to.include('Promise<ProductList>');
      expect(actualOutput).to.include('Promise<Product>');
    });

    it('should correctly handle path parameters and options separation', () => {
      // Read orders spec (has path parameters)
      const specPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
      const specContent = fs.readFileSync(specPath, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);
      
      // Generate output
      const generator = new OpenAPIToConnector(spec, 'test-shop');
      const actualOutput = generator.generateResourceClass('OrdersResource');
      
      // Verify path parameters are handled correctly
      expect(actualOutput).to.include('export function getOrder(this: any, orderId: string)');
      expect(actualOutput).to.include('export function updateOrderStatus(this: any, orderId: string, options');
      expect(actualOutput).to.include('export function cancelOrder(this: any, orderId: string)');
      
      // Verify methods without options don't have unnecessary code
      expect(actualOutput).to.match(/export function getOrder\(this: any, orderId: string\) \{/);
      expect(actualOutput).to.match(/export function cancelOrder\(this: any, orderId: string\) \{/);
    });

    it('should correctly expose resource methods in main controller', () => {
      // Read both specs
      const productsSpecPath = path.join(__dirname, 'scenarios/complex/specs/products.json');
      const ordersSpecPath = path.join(__dirname, 'scenarios/complex/specs/orders.json');
      const productsSpecContent = fs.readFileSync(productsSpecPath, 'utf-8');
      const ordersSpecContent = fs.readFileSync(ordersSpecPath, 'utf-8');
      
      const productsSpec = OpenAPIToConnector.parseSpec(productsSpecContent);
      const ordersSpec = OpenAPIToConnector.parseSpec(ordersSpecContent);
      
      // Generate main controller
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
      
      // Verify exposed methods exist
      expect(actualOutput).to.include('async productsGetProducts(');
      expect(actualOutput).to.include('async productsCreateProduct(');
      expect(actualOutput).to.include('async productsGetProduct(');
      expect(actualOutput).to.include('async productsUpdateProduct(');
      expect(actualOutput).to.include('async productsDeleteProduct(');
      
      expect(actualOutput).to.include('async ordersGetOrders(');
      expect(actualOutput).to.include('async ordersCreateOrder(');
      expect(actualOutput).to.include('async ordersGetOrder(');
      expect(actualOutput).to.include('async ordersUpdateOrderStatus(');
      expect(actualOutput).to.include('async ordersCancelOrder(');
      
      // Verify resource binding
      expect(actualOutput).to.include('this.bindResourceFunctions(\'products\', productsFunctions);');
      expect(actualOutput).to.include('this.bindResourceFunctions(\'orders\', ordersFunctions);');
    });
  });

  describe('Regression Tests', () => {
    it('should handle OpenAPI schemas with different naming patterns', () => {
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
      
      // Should generate valid TypeScript interface names
      expect(output).to.include('export interface Complex_Name_With_Dots {');
      expect(output).to.not.include('export interface Complex.Name.With.Dots {'); // Invalid TS
      expect(output).to.include('Promise<Complex_Name_With_Dots>');
    });

    it('should not add options parameter to methods that don\'t need it', () => {
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
      
      // Should not have options parameter or initialization
      expect(output).to.include('async getSimple() {');
      expect(output).to.not.include('options = options || {}');
      expect(output).to.not.include('headers: options');
    });
  });
});