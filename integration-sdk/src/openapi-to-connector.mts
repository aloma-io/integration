#!/usr/bin/env node

import {Command} from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {OpenAPIV3} from 'openapi-types';
import {z} from 'zod';

// OpenAPI 3.x validation schema
const OpenAPISchema = z.object({
  openapi: z.string().regex(/^3\.\d+\.\d+$/),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  paths: z.record(z.string(), z.any()),
  servers: z
    .array(
      z.object({
        url: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  components: z.any().optional(),
});

interface OperationInfo {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: any[];
  requestBody?: any;
  responses?: any;
}

export class OpenAPIToConnector {
  private spec: OpenAPIV3.Document;
  private connectorName: string;

  constructor(spec: OpenAPIV3.Document, connectorName: string) {
    this.spec = spec;
    this.connectorName = connectorName;
  }

  /**
   * Parse OpenAPI spec from JSON or YAML string
   */
  static parseSpec(specString: string): OpenAPIV3.Document {
    let parsed: any;

    try {
      // Try parsing as JSON first
      parsed = JSON.parse(specString);
    } catch {
      try {
        // If JSON fails, try YAML
        parsed = yaml.load(specString);
      } catch (error) {
        throw new Error(`Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Validate against OpenAPI 3.x schema with lenient validation
    const validationResult = OpenAPISchema.safeParse(parsed);
    if (!validationResult.success) {
      // Check if the errors are just about missing 'type' fields in schemas
      const criticalErrors = validationResult.error.errors.filter((err) => {
        const path = err.path.join('.');
        // Allow missing 'type' in schema definitions as many OpenAPI specs don't include it
        return !path.includes('components.schemas') || !err.message.includes('Required');
      });

      if (criticalErrors.length > 0) {
        const errors = criticalErrors.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ');
        throw new Error(`Invalid OpenAPI 3.x specification: ${errors}`);
      }

      // Log a warning about lenient validation
      console.warn('⚠️  OpenAPI spec has some validation warnings but proceeding with lenient validation...');
    }

    return parsed as OpenAPIV3.Document;
  }

  /**
   * Extract all operations from the OpenAPI spec
   */
  private extractOperations(): OperationInfo[] {
    const operations: OperationInfo[] = [];

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      if (!pathItem) continue;

      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        operations.push({
          method: method.toUpperCase(),
          path,
          operationId: operation.operationId,
          summary: operation.summary,
          description: operation.description,
          parameters: operation.parameters,
          requestBody: operation.requestBody,
          responses: operation.responses,
        });
      }
    }

    return operations;
  }

  /**
   * Generate a valid JavaScript identifier from a string
   */
  private toValidIdentifier(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9_$]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Generate method name from operation info
   */
  private generateMethodName(operation: OperationInfo): string {
    if (operation.operationId) {
      // Clean up HubSpot-style operationIds like "get-/crm/v3/objects/companies_getPage"
      let cleaned = operation.operationId;

      // Extract the last part after underscore if it exists
      const parts = cleaned.split('_');
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        // If the last part looks like a method name (camelCase), use it
        if (lastPart && /^[a-z][a-zA-Z0-9]*$/.test(lastPart)) {
          cleaned = lastPart;
        }
      }

      // Remove any remaining special characters and clean up
      cleaned = cleaned
        .replace(/^(get|post|put|patch|delete|head|options)-/i, '') // Remove HTTP method prefix
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      // If we still have a valid identifier, use it
      if (cleaned && /^[a-zA-Z]/.test(cleaned)) {
        return cleaned;
      }
    }

    // Generate from method + path
    const pathParts = operation.path
      .replace(/[{}]/g, '') // Remove path parameters
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => this.toValidIdentifier(part));

    const methodPrefix = operation.method.toLowerCase();
    const pathSuffix = pathParts.join('_') || 'root';

    return `${methodPrefix}_${pathSuffix}`;
  }

  /**
   * Generate JSDoc comment for an operation
   */
  private generateJSDoc(operation: OperationInfo): string {
    const lines: string[] = [];
    const pathParams: any[] = [];
    const queryParams: any[] = [];
    const hasBody = !!operation.requestBody;

    if (operation.summary) {
      lines.push(` * ${operation.summary}`);
    }

    if (operation.description) {
      lines.push(` *`);
      // Split long descriptions into multiple lines
      const descLines = operation.description.split('\n');
      descLines.forEach((line) => {
        if (line.trim()) {
          lines.push(` * ${line.trim()}`);
        }
      });
    }

    // Identify path and query parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (typeof param === 'object' && 'name' in param && 'in' in param) {
          if (param.in === 'path') {
            pathParams.push(param);
          } else if (param.in === 'query') {
            queryParams.push(param);
          }
        }
      }
    }

    // Check if using simple signature
    const useSimpleSignature = queryParams.length === 0 && !hasBody && pathParams.length <= 1;

    if (useSimpleSignature && pathParams.length === 1) {
      // Simple signature documentation
      const param = pathParams[0];
      const paramType = param.schema?.type || 'string';
      const paramDesc = param.description || '';
      lines.push(' *');
      lines.push(` * @param {${paramType}} ${param.name} ${paramDesc}`);
      lines.push(` * @param {Object} options (optional) - Request options`);
      lines.push(` * @param {Object} options.headers - Custom headers`);
    } else {
      // Options object documentation
      lines.push(' *');

      // Check if there are any required parameters
      const hasRequiredParams =
        pathParams.some((p) => p.required) ||
        queryParams.some((p) => p.required) ||
        (operation.requestBody && operation.requestBody.required);

      const optionsRequired = hasRequiredParams ? '(required)' : '(optional)';
      lines.push(` * @param {Object} options ${optionsRequired} - Request options`);

      // Document path parameters
      for (const param of pathParams) {
        const paramType = param.schema?.type || 'string';
        const paramDesc = param.description || '';
        const paramRequired = param.required ? '(required)' : '(optional)';
        lines.push(` * @param {${paramType}} options.${param.name} ${paramRequired} - ${paramDesc} [path]`);
      }

      // Document query parameters
      for (const param of queryParams) {
        const paramType = param.schema?.type || 'any';
        const paramDesc = param.description || '';
        const paramRequired = param.required ? '(required)' : '(optional)';
        lines.push(` * @param {${paramType}} options.${param.name} ${paramRequired} - ${paramDesc} [query]`);
      }

      // Document request body
      if (operation.requestBody) {
        const bodyDesc = operation.requestBody.description || 'Request body';
        const required = operation.requestBody.required ? '(required)' : '(optional)';
        lines.push(` * @param {Object} options.body ${required} - ${bodyDesc}`);
      }

      // Document headers
      lines.push(` * @param {Object} options.headers (optional) - Custom headers to include in the request`);
    }

    // Document response
    lines.push(' *');
    lines.push(` * @returns {Promise<Object>} ${operation.method} ${operation.path} response`);

    return lines.join('\n');
  }

  /**
   * Get the number of operations in the OpenAPI spec
   */
  getOperationsCount(): number {
    return this.extractOperations().length;
  }

  /**
   * Generate method signature with options object
   */
  private generateMethodSignature(operation: OperationInfo): string {
    const pathParams: Array<{name: string; required: boolean; type: string}> = [];
    const queryParams: Array<{name: string; required: boolean; type: string}> = [];
    const hasBody = !!operation.requestBody;

    // Identify path and query parameters with their types and required status
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (typeof param === 'object' && 'name' in param && 'in' in param) {
          const paramInfo = {
            name: param.name,
            required: param.required || false,
            type: this.getParameterType(param),
          };

          if (param.in === 'path') {
            pathParams.push(paramInfo);
          } else if (param.in === 'query') {
            queryParams.push(paramInfo);
          }
        }
      }
    }

    // If there are no query params, no body, and only path params, use simple signature
    if (queryParams.length === 0 && !hasBody && pathParams.length <= 1) {
      const params: string[] = [];
      for (const paramInfo of pathParams) {
        params.push(`${paramInfo.name}: ${paramInfo.type}`);
      }
      params.push(`options?: {headers?: {[key: string]: any}}`);
      return `(${params.join(', ')})`;
    }

    // Check if there are any required parameters
    const hasRequiredParams =
      pathParams.some((p) => p.required) ||
      queryParams.some((p) => p.required) ||
      (hasBody && operation.requestBody?.required);

    // Build detailed options object with proper types
    // Group nested properties into objects (e.g., PrimaryContact.FirstName -> PrimaryContact: {FirstName: string})
    const nestedObjects: Map<string, Array<{name: string; type: string; required: boolean}>> = new Map();
    const flatProps: Array<{name: string; type: string; required: boolean}> = [];

    // Process all parameters (path + query)
    const allParams = [...pathParams, ...queryParams];

    for (const paramInfo of allParams) {
      if (paramInfo.name.includes('.')) {
        // This is a nested property like PrimaryContact.FirstName
        const parts = paramInfo.name.split('.');
        const objectName = parts[0];
        const propertyName = parts.slice(1).join('.');

        if (!nestedObjects.has(objectName)) {
          nestedObjects.set(objectName, []);
        }
        nestedObjects.get(objectName)!.push({
          name: propertyName,
          type: paramInfo.type,
          required: paramInfo.required,
        });
      } else {
        // This is a flat property
        flatProps.push({
          name: paramInfo.name,
          type: paramInfo.type,
          required: paramInfo.required,
        });
      }
    }

    // Build the options properties array
    const optionProps: string[] = [];

    // Add flat properties
    for (const prop of flatProps) {
      const optional = prop.required ? '' : '?';
      optionProps.push(`${prop.name}${optional}: ${prop.type}`);
    }

    // Add nested objects
    for (const [objectName, properties] of nestedObjects) {
      const nestedProps = properties
        .map((p) => {
          const optional = p.required ? '' : '?';
          return `${p.name}${optional}: ${p.type}`;
        })
        .join(', ');

      // Check if all properties are optional
      const allOptional = properties.every((p) => !p.required);
      const optional = allOptional ? '?' : '';

      optionProps.push(`${objectName}${optional}: {${nestedProps}}`);
    }

    // Add request body
    if (hasBody) {
      optionProps.push('body?: any');
    }

    // Add custom headers
    optionProps.push('headers?: {[key: string]: any}');

    // If there are too many parameters, use simplified signature to avoid parsing issues
    // Also check if any parameter name is too long (over 100 chars) which can cause issues
    const hasLongParamNames = optionProps.some((prop) => prop.length > 100);
    if (optionProps.length > 15 || hasLongParamNames) {
      const required = hasRequiredParams ? '' : '?';
      return `(options${required}: {[key: string]: any})`;
    }

    const required = hasRequiredParams ? '' : '?';
    return `(options${required}: {${optionProps.join(', ')}})`;
  }

  /**
   * Get TypeScript type for a parameter based on its schema
   */
  private getParameterType(param: any): string {
    if (param.schema) {
      const schema = param.schema;

      // Handle different schema types
      if (schema.type) {
        switch (schema.type) {
          case 'string':
            return 'string';
          case 'integer':
          case 'number':
            return 'number';
          case 'boolean':
            return 'boolean';
          case 'array':
            return 'any[]';
          case 'object':
            return 'any';
          default:
            return 'any';
        }
      }

      // Handle enum
      if (schema.enum) {
        return 'string';
      }

      // Handle $ref
      if (schema.$ref) {
        return 'any';
      }
    }

    return 'any';
  }

  /**
   * Generate method implementation code
   */
  private generateMethodImplementation(operation: OperationInfo): string {
    const lines: string[] = [];

    // Build URL with path parameters
    let url = operation.path;
    const pathParams: string[] = [];
    const queryParams: string[] = [];
    const hasBody = !!operation.requestBody;

    // Identify path and query parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (typeof param === 'object' && 'name' in param && 'in' in param) {
          if (param.in === 'path') {
            pathParams.push(param.name);
          } else if (param.in === 'query') {
            queryParams.push(param.name);
          }
        }
      }
    }

    // Check if using simple signature (single path param, no query/body)
    const useSimpleSignature = queryParams.length === 0 && !hasBody && pathParams.length <= 1;

    if (useSimpleSignature && pathParams.length === 1) {
      // Simple signature: (pathParam: string, options?: {headers?: ...})
      const paramName = pathParams[0];
      lines.push(`    let url = '${url}';`);
      lines.push(`    if (${paramName}) {`);
      lines.push(`      url = url.replace('{${paramName}}', ${paramName});`);
      lines.push(`    }`);
      lines.push('');
      lines.push(`    return this.api.fetch(url, {`);
      lines.push(`      method: '${operation.method}',`);
      lines.push(`      headers: options?.headers,`);
      lines.push(`    });`);
    } else {
      // Options object pattern
      lines.push(`    options = options || {};`);
      lines.push('');

      // Replace path parameters
      if (pathParams.length > 0) {
        lines.push(`    // Build URL with path parameters`);
        lines.push(`    let url = '${url}';`);
        for (const paramName of pathParams) {
          lines.push(`    if (options.${paramName}) {`);
          lines.push(`      url = url.replace('{${paramName}}', options.${paramName});`);
          lines.push(`    }`);
        }
        lines.push('');
      } else {
        lines.push(`    const url = '${url}';`);
        lines.push('');
      }

      // Build fetch options
      lines.push(`    const fetchOptions: any = {`);
      lines.push(`      method: '${operation.method}',`);

      // Add query parameters
      if (queryParams.length > 0) {
        lines.push(`      params: {},`);
      }

      // Add body if present
      if (hasBody) {
        lines.push(`      body: options.body,`);
      }

      // Add headers if present
      lines.push(`      headers: options.headers,`);

      lines.push(`    };`);
      lines.push('');

      // Add query parameters to options
      if (queryParams.length > 0) {
        lines.push(`    // Add query parameters`);
        for (const paramName of queryParams) {
          lines.push(`    if (options.${paramName} !== undefined) {`);
          lines.push(`      fetchOptions.params.${paramName} = options.${paramName};`);
          lines.push(`    }`);
        }
        lines.push('');
      }

      // Make the API call
      lines.push(`    return this.api.fetch(url, fetchOptions);`);
    }

    return lines.join('\n');
  }

  /**
   * Generate method implementation for resource functions (using this.api instead of this.controller)
   */
  private generateResourceFunctionImplementation(operation: OperationInfo): string {
    const lines: string[] = [];
    const url = operation.path;
    const pathParams: string[] = [];
    const queryParams: string[] = [];
    const hasBody = !!operation.requestBody;

    // Identify parameters
    if (operation.parameters) {
      operation.parameters.forEach((param: any) => {
        if (param.in === 'path') {
          pathParams.push(param.name);
        } else if (param.in === 'query') {
          queryParams.push(param.name);
        }
      });
    }

    // Simple single parameter pattern for simple operations
    const isSimple = pathParams.length <= 1 && queryParams.length === 0 && !hasBody;
    
    if (isSimple && pathParams.length === 1) {
      const paramName = pathParams[0];
      lines.push(`  let url = '${url}';`);
      lines.push(`  if (${paramName}) {`);
      lines.push(`    url = url.replace('{${paramName}}', ${paramName});`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  return this.api.fetch(url, {`);
      lines.push(`    method: '${operation.method}',`);
      lines.push(`    headers: options?.headers,`);
      lines.push(`  });`);
    } else {
      // Options object pattern
      lines.push(`  options = options || {};`);
      lines.push('');

      // Replace path parameters
      if (pathParams.length > 0) {
        lines.push(`  // Build URL with path parameters`);
        lines.push(`  let url = '${url}';`);
        for (const paramName of pathParams) {
          lines.push(`  if (options.${paramName}) {`);
          lines.push(`    url = url.replace('{${paramName}}', options.${paramName});`);
          lines.push(`  }`);
        }
        lines.push('');
      } else {
        lines.push(`  const url = '${url}';`);
        lines.push('');
      }

      // Build fetch options
      lines.push(`  const fetchOptions: any = {`);
      lines.push(`    method: '${operation.method}',`);

      // Add query parameters
      if (queryParams.length > 0) {
        lines.push(`    params: {},`);
      }

      // Add body if present
      if (hasBody) {
        lines.push(`    body: options.body,`);
      }

      // Add headers if present
      lines.push(`    headers: options.headers,`);

      lines.push(`  };`);
      lines.push('');

      // Add query parameters to options
      if (queryParams.length > 0) {
        lines.push(`  // Add query parameters`);
        for (const paramName of queryParams) {
          lines.push(`  if (options.${paramName} !== undefined) {`);
          lines.push(`    fetchOptions.params.${paramName} = options.${paramName};`);
          lines.push(`  }`);
        }
        lines.push('');
      }

      // Make the API call
      lines.push(`  return this.api.fetch(url, fetchOptions);`);
    }

    return lines.join('\n');
  }

  /**
   * Generate exposed resource methods for API introspection
   */
  private generateExposedResourceMethods(resources: Array<{className: string; fileName: string}>, resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>): string {
    const methods: string[] = [];

    for (const resource of resources) {
      const resourceName = resource.fileName;
      
      // Find the corresponding spec for this resource
      const resourceSpec = resourceSpecs?.find(rs => rs.fileName === resourceName);
      
      if (resourceSpec) {
        // Create a temporary generator for this resource's spec
        const resourceGenerator = new OpenAPIToConnector(resourceSpec.spec, resourceName);
        const operations = resourceGenerator.extractOperations();
        
        for (const operation of operations) {
          const methodName = resourceGenerator.generateMethodName(operation);
          const jsdoc = resourceGenerator.generateJSDoc(operation);
          const signature = resourceGenerator.generateMethodSignature(operation);
          
          // Generate the exposed method that delegates to the resource
          const exposedMethodName = `${resourceName}${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`;
          
          methods.push(`  /**
${jsdoc}
   */
  async ${exposedMethodName}${signature} {
    return this.${resourceName}.${methodName}?.(${this.generateParameterCall(signature)});
  }`);
        }
      } else {
        // Fallback to common CRUD operations if no spec provided
        const commonOperations = [
          { name: 'getPage', comment: 'Retrieve items with pagination', signature: 'options?: {limit?: number, after?: string, properties?: any[], archived?: boolean, headers?: {[key: string]: any}}' },
          { name: 'getById', comment: 'Get item by ID', signature: 'options: {id: string, properties?: any[], headers?: {[key: string]: any}}' },
          { name: 'create', comment: 'Create a new item', signature: 'options: {body?: any, headers?: {[key: string]: any}}' },
          { name: 'update', comment: 'Update an item', signature: 'options: {id: string, body?: any, headers?: {[key: string]: any}}' },
          { name: 'read', comment: 'Retrieve a batch of items', signature: 'options: {body?: any, headers?: {[key: string]: any}}' },
        ];

        for (const op of commonOperations) {
          const exposedMethodName = `${resourceName}${op.name.charAt(0).toUpperCase() + op.name.slice(1)}`;
          methods.push(`  /**
   * ${op.comment} (${resourceName})
   */
  async ${exposedMethodName}(${op.signature}) {
    return this.${resourceName}.${op.name}?.(options);
  }`);
        }
      }
    }

    return methods.join('\n\n');
  }

  /**
   * Generate parameter call from method signature
   */
  private generateParameterCall(signature: string): string {
    // Extract parameter names from signature like (options: {...}) or (id: string, options?: {...})
    const paramMatch = signature.match(/\(([^)]+)\)/);
    if (!paramMatch) return '';
    
    const params = paramMatch[1].split(',').map(p => {
      const paramName = p.trim().split(':')[0].trim();
      // Remove optional markers like ?, but keep the parameter name
      return paramName.replace(/[?]/g, '');
    }).filter(p => p.length > 0);
    
    return params.join(', ');
  }

  /**
   * Generate proper import paths with .mjs extensions for TypeScript module resolution
   */
  private generateImportPath(relativePath: string): string {
    // For resource classes, we need to reference the compiled .mjs files
    return relativePath.endsWith('.mjs') ? relativePath : `${relativePath}.mjs`;
  }

  /**
   * Generate a resource file with exported functions (new pattern for proper introspection)
   */
  generateResourceClass(className: string): string {
    const operations = this.extractOperations();

    if (operations.length === 0) {
      throw new Error('No operations found in OpenAPI specification');
    }

    const resourceName = className.replace('Resource', '').toLowerCase();
    
    const functions = operations
      .map((operation) => {
        const methodName = this.generateMethodName(operation);
        const jsdoc = this.generateJSDoc(operation);
        const signature = this.generateMethodSignature(operation);
        const implementation = this.generateResourceFunctionImplementation(operation);

        return `/**\n${jsdoc}\n */\nexport function ${methodName}(this: any, ${signature.replace('(', '').replace(')', '')}) {\n${implementation}\n}`;
      })
      .join('\n\n');

    return `// ${className} resource functions
// These functions will be bound to the controller instance and accessible as ${resourceName}.method()

${functions}`;
  }

  /**
   * Generate a main controller that composes multiple resources using function binding
   */
  generateMainController(resources: Array<{className: string; fileName: string}>, resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>): string {
    // Get base URL from servers if available
    const baseUrl = this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'https://api.example.com';

    const imports = resources
      .map((resource) => `import * as ${resource.fileName}Functions from '../resources/${resource.fileName}.mjs';`)
      .join('\n');

    const properties = resources
      .map((resource) => `  ${resource.fileName}: any = {};`)
      .join('\n');

    const bindings = resources
      .map((resource) => `    this.bindResourceFunctions('${resource.fileName}', ${resource.fileName}Functions);`)
      .join('\n');

    // Generate exposed methods for each resource to enable API introspection
    const exposedMethods = this.generateExposedResourceMethods(resources, resourceSpecs);

    return `import {AbstractController} from '@aloma.io/integration-sdk';
${imports}

export default class Controller extends AbstractController {
${properties}

  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;
    
    this.api = this.getClient({
      baseUrl: '${baseUrl}',
      customize(request) {
        request.headers ||= {};
        // Add authentication headers based on your API requirements
        // Example: request.headers["Authorization"] = \`Bearer \${config.apiToken}\`;
      },
    });
    
    // Bind resource functions to this controller context
    // This allows using this.resourceName.method() syntax
${bindings}
  }

  private bindResourceFunctions(resourceName: string, functions: any) {
    for (const [functionName, func] of Object.entries(functions)) {
      if (typeof func === 'function') {
        this[resourceName][functionName] = func.bind(this);
      }
    }
  }

  /**
   * Generic API request method
   * @param url - API endpoint
   * @param options - Request options
   */
  async request({ url, options }: { url: string; options?: any }) {
    return this.api.fetch(url, options);
  }

${exposedMethods}
}`;
  }

  /**
   * Generate the connector controller code
   */
  generateController(): string {
    const operations = this.extractOperations();

    if (operations.length === 0) {
      throw new Error('No operations found in OpenAPI specification');
    }

    const methods = operations
      .map((operation) => {
        const methodName = this.generateMethodName(operation);
        const jsdoc = this.generateJSDoc(operation);
        const signature = this.generateMethodSignature(operation);
        const implementation = this.generateMethodImplementation(operation);

        return `  /**\n${jsdoc}\n   */\n  async ${methodName}${signature} {\n${implementation}\n  }`;
      })
      .join('\n\n');

    // Get base URL from servers if available
    const baseUrl = this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'API_BASE_URL';

    const startMethod = `  private api: any;

  protected async start(): Promise<void> {
    this.api = this.getClient({
      baseUrl: '${baseUrl}',
    });
  }`;

    return `import {AbstractController} from '@aloma.io/integration-sdk';

export default class Controller extends AbstractController {
  
${startMethod}

${methods}
}`;
  }
}

// CLI setup
const program = new Command();

program
  .name('openapi-to-connector')
  .description('Generate a connector controller from an OpenAPI specification')
  .version('1.0.0')
  .showHelpAfterError();

program
  .command('generate')
  .description('Generate connector controller from OpenAPI spec')
  .requiredOption('--name <name>', 'Human-readable connector name')
  .requiredOption('--spec <file>', 'OpenAPI specification file (JSON or YAML)')
  .option('--out <file>', 'Output file path', 'index.mts')
  .action(async (options) => {
    try {
      // Read and parse the OpenAPI spec
      const specContent = fs.readFileSync(options.spec, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);

      // Generate the connector controller
      const generator = new OpenAPIToConnector(spec, options.name);
      const controllerCode = generator.generateController();

      // Write the output file
      fs.writeFileSync(options.out, controllerCode);

      console.log(`✅ Successfully generated connector controller: ${options.out}`);
      console.log(`📝 Connector name: ${options.name}`);
      console.log(`📊 Found ${generator['extractOperations']().length} operations`);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Only run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // If no command is provided, show help
  if (process.argv.length <= 2) {
    program.help();
  } else {
    program.parse();
  }
}
