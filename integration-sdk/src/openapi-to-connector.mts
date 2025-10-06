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

    // Validate against OpenAPI 3.x schema
    const validationResult = OpenAPISchema.safeParse(parsed);
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Invalid OpenAPI 3.x specification: ${errors}`);
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

    if (operation.summary) {
      lines.push(` * ${operation.summary}`);
    }

    if (operation.description) {
      lines.push(` *`);
      // Split long descriptions into multiple lines
      const descLines = operation.description.split('\n');
      descLines.forEach(line => {
        if (line.trim()) {
          lines.push(` * ${line.trim()}`);
        }
      });
    }

    // Document parameters with full details
    if (operation.parameters && operation.parameters.length > 0) {
      lines.push(' *');
      lines.push(' * @param {Object} args - Request arguments');
      
      for (const param of operation.parameters) {
        if (typeof param === 'object' && 'name' in param) {
          const paramName = param.name;
          const paramDesc = param.description || '';
          const paramRequired = param.required ? '(required)' : '(optional)';
          const paramType = param.schema?.type || 'any';
          const paramIn = param.in || '';
          
          let paramDoc = ` * @param {${paramType}} args.${paramName} ${paramRequired}`;
          if (paramDesc) {
            paramDoc += ` - ${paramDesc}`;
          }
          if (paramIn) {
            paramDoc += ` [${paramIn}]`;
          }
          lines.push(paramDoc);
        }
      }
    }

    // Document request body
    if (operation.requestBody) {
      lines.push(' *');
      const bodyDesc = operation.requestBody.description || 'Request body';
      const required = operation.requestBody.required ? '(required)' : '(optional)';
      lines.push(` * @param {Object} args.body ${required} - ${bodyDesc}`);
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

        return `  /**\n${jsdoc}\n   */\n  async ${methodName}(args: any) {\n    // TODO: Implement ${operation.method} ${operation.path}\n    throw new Error('Method not implemented');\n  }`;
      })
      .join('\n\n');

    return `import {AbstractController} from '@aloma.io/integration-sdk';

export default class Controller extends AbstractController {
  
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
