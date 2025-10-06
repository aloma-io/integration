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

    it('should reject invalid JSON/YAML', () => {
      expect(() => {
        OpenAPIToConnector.parseSpec('invalid json {');
      }).to.throw('Failed to parse OpenAPI spec');
    });
  });

  describe('generateController', () => {
    it('should generate controller with all operations', () => {
      const generator = new OpenAPIToConnector(validOpenAPISpec, 'Test Connector');
      const controllerCode = generator.generateController();
      
      expect(controllerCode).to.include('import {AbstractController}');
      expect(controllerCode).to.include('export default class Controller extends AbstractController');
      expect(controllerCode).to.include('async getUsers(args: any)');
      expect(controllerCode).to.include('async createUser(args: any)');
      expect(controllerCode).to.include('async get_users_{id}(args: any)');
    });

    it('should generate proper JSDoc comments', () => {
      const generator = new OpenAPIToConnector(validOpenAPISpec, 'Test Connector');
      const controllerCode = generator.generateController();
      
      expect(controllerCode).to.include('* Get all users');
      expect(controllerCode).to.include('* Retrieve a list of all users');
      expect(controllerCode).to.include('* @param args.body - Request body');
      expect(controllerCode).to.include('* @param args.id - User ID');
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
      
      expect(controllerCode).to.include('async get_test(args: any)');
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
