import { describe, it } from 'mocha';
import { expect } from 'chai';
import { OpenAPIToConnector } from '../build/openapi-to-connector.mjs';

describe('OpenAPIToConnector', () => {
  const validOpenAPISpec = {
    openapi: '3.0.0' as const,
    info: {
      title: 'Test API',
      version: '1.0.0',
      description: 'A test API'
    },
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          summary: 'Get all users',
          description: 'Retrieve a list of all users',
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'array' as const,
                    items: {
                      type: 'object' as const,
                      properties: {
                        id: { type: 'string' as const },
                        name: { type: 'string' as const }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          operationId: 'createUser',
          summary: 'Create a new user',
          description: 'Create a new user in the system',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    name: { type: 'string' as const },
                    email: { type: 'string' as const }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'User created successfully'
            }
          }
        }
      },
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          summary: 'Get user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path' as const,
              required: true,
              schema: { type: 'string' as const },
              description: 'User ID'
            }
          ],
          responses: {
            '200': {
              description: 'User found'
            }
          }
        }
      }
    }
  };

  describe('parseSpec', () => {
    it('should parse valid OpenAPI 3.0 JSON spec', () => {
      const specString = JSON.stringify(validOpenAPISpec);
      const result = OpenAPIToConnector.parseSpec(specString);
      
      expect(result.openapi).to.equal('3.0.0');
      expect(result.info.title).to.equal('Test API');
      expect(result.paths).to.have.property('/users');
    });

    it('should parse valid OpenAPI 3.0 YAML spec', () => {
      const yamlSpec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
  description: A test API
paths:
  /users:
    get:
      operationId: getUsers
      summary: Get all users
      responses:
        '200':
          description: Successful response
`;
      const result = OpenAPIToConnector.parseSpec(yamlSpec);
      
      expect(result.openapi).to.equal('3.0.0');
      expect(result.info.title).to.equal('Test API');
    });

    it('should reject invalid OpenAPI version', () => {
      const invalidSpec = {
        ...validOpenAPISpec,
        openapi: '2.0.0'
      };
      
      expect(() => {
        OpenAPIToConnector.parseSpec(JSON.stringify(invalidSpec));
      }).to.throw('Invalid OpenAPI 3.x specification');
    });

    it('should reject spec without required fields', () => {
      const invalidSpec = {
        openapi: '3.0.0'
        // Missing info and paths
      };
      
      expect(() => {
        OpenAPIToConnector.parseSpec(JSON.stringify(invalidSpec));
      }).to.throw('Invalid OpenAPI 3.x specification');
    });

    it('names the field that fails validation (zod 4 reports issues, not errors)', () => {
      const missingTitle = {openapi: '3.0.0', info: {version: '1.0.0'}, paths: {}};
      expect(() => {
        OpenAPIToConnector.parseSpec(JSON.stringify(missingTitle));
      }).to.throw(/Invalid OpenAPI 3\.x specification: info\.title: /);
    });

    it('should reject invalid JSON/YAML', () => {
      expect(() => {
        OpenAPIToConnector.parseSpec('invalid json {');
      // PINS: expectation updated to today's output on 24 Oct; original expected 'Failed to parse OpenAPI spec'.
      // 'invalid json {' is not JSON, but js-yaml loads it as a plain string, so it is rejected by the schema check.
      }).to.throw('Invalid OpenAPI 3.x specification');
    });
  });

  describe('generateController', () => {
    it('should generate controller with all operations', () => {
      const generator = new OpenAPIToConnector(validOpenAPISpec, 'Test Connector');
      const controllerCode = generator.generateController();
      
      expect(controllerCode).to.include('import {AbstractController}');
      expect(controllerCode).to.include('export default class Controller extends AbstractController');
      // PINS: expectation updated to today's output on 24 Oct; original expected 'async getUsers(args: any)',
      // 'async createUser(args: any)' and 'async get_users_{id}(args: any)' (an older args-object signature; the
      // third name never matched the spec's operationId getUserById, path params are now positional).
      expect(controllerCode).to.include('async getUsers(options?: {headers?: Record<string, string>})');
      expect(controllerCode).to.include('async createUser(options');
      expect(controllerCode).to.include('async getUserById(id: string, options?: {headers?: Record<string, string>})');
    });

    it('should generate proper JSDoc comments', () => {
      const generator = new OpenAPIToConnector(validOpenAPISpec, 'Test Connector');
      const controllerCode = generator.generateController();
      
      expect(controllerCode).to.include('* Get all users');
      expect(controllerCode).to.include('* Retrieve a list of all users');
      // PINS: expectation updated to today's output on 24 Oct; original expected '* @param args.body - Request body'
      // and '* @param args.id - User ID' (older args-object JSDoc; the object body is now expanded into its properties).
      expect(controllerCode).to.include('* @param {string} options.name (required)');
      expect(controllerCode).to.include('* @param {string} id User ID');
    });

    it('should substitute path parameters into the url', () => {
      // Added on 24 Oct with the entry-point fix: nothing asserted the generated path parameter handling before.
      const generator = new OpenAPIToConnector(validOpenAPISpec, 'Test Connector');
      const controllerCode = generator.generateController();

      expect(controllerCode).to.include("let url = '/users/{id}';");
      expect(controllerCode).to.include('if (id) {');
      expect(controllerCode).to.include("url = url.replace('{id}', id);");
    });

    it('should handle operations without operationId', () => {
      const specWithoutOperationId = {
        ...validOpenAPISpec,
        paths: {
          '/test': {
            get: {
              summary: 'Test endpoint',
              responses: {
                '200': {
                  description: 'Success'
                }
              }
            }
          }
        }
      };
      
      const generator = new OpenAPIToConnector(specWithoutOperationId, 'Test Connector');
      const controllerCode = generator.generateController();
      
      // PINS: expectation updated to today's output on 24 Oct; original expected 'async get_test(args: any)'.
      expect(controllerCode).to.include('async get_test(options?: {headers?: Record<string, string>})');
    });

    it('should throw error for empty spec', () => {
      const emptySpec = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {}
      };
      
      const generator = new OpenAPIToConnector(emptySpec, 'Test Connector');
      
      expect(() => {
        generator.generateController();
      }).to.throw('No operations found in OpenAPI specification');
    });
  });
});
