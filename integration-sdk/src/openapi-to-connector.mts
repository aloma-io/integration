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
      lines.push(` * @param {Object} options (optional) - Request options`);

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

    // If there are no query params, no body, and only path params, use simple signature
    if (queryParams.length === 0 && !hasBody && pathParams.length <= 1) {
      const params: string[] = [];
      for (const paramName of pathParams) {
        params.push(`${paramName}: string`);
      }
      params.push(`options?: {headers?: {[key: string]: any}}`);
      return `(${params.join(', ')})`;
    }

    // Otherwise, use options object pattern
    return `(options?: {${[
      ...pathParams.map((p) => `${p}?: string`),
      ...queryParams.map((p) => `${p}?: any`),
      hasBody ? 'body?: any' : '',
      'headers?: {[key: string]: any}',
    ]
      .filter(Boolean)
      .join(', ')}})`;
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
   * Generate proper import paths with .mjs extensions for TypeScript module resolution
   */
  private generateImportPath(relativePath: string): string {
    // For resource classes, we need to reference the compiled .mjs files
    return relativePath.endsWith('.mjs') ? relativePath : `${relativePath}.mjs`;
  }

  /**
   * Generate a resource class (does NOT extend AbstractController, receives controller reference)
   */
  generateResourceClass(className: string): string {
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

    return `import {AbstractController} from '@aloma.io/integration-sdk';

export default class ${className} {
  private controller: AbstractController;

  constructor(controller: AbstractController) {
    this.controller = controller;
  }

  private get api() {
    return this.controller['api'];
  }

${methods}
}`;
  }

  /**
   * Generate a main controller that composes multiple resources
   */
  generateMainController(resources: Array<{className: string; fileName: string}>): string {
    // Get base URL from servers if available
    const baseUrl = this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'API_BASE_URL';

    const imports = resources
      .map((resource) => `import ${resource.className} from '../resources/${resource.fileName}.mjs';`)
      .join('\n');

    const properties = resources
      .map((resource) => `  ${resource.className.toLowerCase().replace('resource', '')}!: ${resource.className};`)
      .join('\n');

    const initializations = resources
      .map(
        (resource) =>
          `    this.${resource.className.toLowerCase().replace('resource', '')} = new ${resource.className}(this);`
      )
      .join('\n');

    return `import {AbstractController} from '@aloma.io/integration-sdk';
${imports}

export default class Controller extends AbstractController {
${properties}

  private api: any;

  protected async start(): Promise<void> {
    this.api = this.getClient({
      baseUrl: '${baseUrl}',
    });
    
    // Initialize each resource - they receive 'this' controller reference
${initializations}
  }
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
