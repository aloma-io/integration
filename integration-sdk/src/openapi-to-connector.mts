#!/usr/bin/env node

import {Command} from 'commander';
import fs from 'node:fs';
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

    // Always extract path parameters as discrete parameters when they exist
    if (pathParams.length > 0) {
      const params: string[] = [];
      for (const paramInfo of pathParams) {
        params.push(`${paramInfo.name}: ${paramInfo.type}`);
      }

      // Build options object for query params and body
      const optionProps: string[] = [];

      // Add query parameters to options
      for (const prop of queryParams) {
        const optional = prop.required ? '' : '?';
        optionProps.push(`${prop.name}${optional}: ${prop.type}`);
      }

      // Add request body properties directly (flattened)
      if (hasBody) {
        this.addRequestBodyProperties(operation.requestBody, optionProps);
      }

      // Check if options parameter is required (has required query params or required body)
      const hasRequiredNonPathParams =
        queryParams.some((p) => p.required) || (hasBody && operation.requestBody?.required);
      const optionsRequired = hasRequiredNonPathParams ? '' : '?';

      // Only add options parameter if there are actual options
      if (optionProps.length > 0) {
        params.push(`options${optionsRequired}: {${optionProps.join(', ')}}`);
      }

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

    // Add request body properties directly (flattened)
    if (hasBody) {
      this.addRequestBodyProperties(operation.requestBody, optionProps);
    }

    // If there are too many parameters, use simplified signature to avoid parsing issues
    // Also check if any parameter name is too long (over 100 chars) which can cause issues
    const hasLongParamNames = optionProps.some((prop) => prop.length > 100);
    if (optionProps.length > 15 || hasLongParamNames) {
      const required = hasRequiredParams ? '' : '?';
      return `(options${required}: {[key: string]: any})`;
    }

    // Only add options if there are actual options
    if (optionProps.length > 0) {
      const required = hasRequiredParams ? '' : '?';
      return `(options${required}: {${optionProps.join(', ')}})`;
    } else {
      return '()';
    }
  }

  /**
   * Resolve a schema reference to a TypeScript type name
   */
  private resolveSchemaRef(ref: string): string {
    // Extract the component name from the reference
    // e.g., "#/components/schemas/Company" -> "Company"
    const parts = ref.split('/');
    if (parts.length >= 2) {
      const componentName = parts[parts.length - 1];
      return this.sanitizeTypeName(componentName);
    }
    return 'any';
  }

  /**
   * Sanitize a name to be a valid TypeScript identifier
   */
  private sanitizeTypeName(name: string): string {
    return (
      name
        // Replace dots with underscores
        .replace(/\./g, '_')
        // Replace + with _Plus (common in OpenAPI for enums)
        .replace(/\+/g, '_Plus')
        // Replace other invalid characters with underscores
        .replace(/[^a-zA-Z0-9_$]/g, '_')
        // Ensure it starts with a letter or underscore
        .replace(/^[0-9]/, '_$&')
        // Remove multiple consecutive underscores
        .replace(/_+/g, '_')
        // Remove trailing/leading underscores
        .replace(/^_+|_+$/g, '') ||
      // Ensure it's not empty
      'UnknownType'
    );
  }

  /**
   * Get TypeScript type from schema object
   */
  private getTypeFromSchema(schema: any): string {
    if (!schema) return 'any';

    // Handle $ref
    if (schema.$ref) {
      return this.resolveSchemaRef(schema.$ref);
    }

    // Handle arrays
    if (schema.type === 'array') {
      if (schema.items) {
        const itemType = this.getTypeFromSchema(schema.items);
        return `${itemType}[]`;
      }
      return 'any[]';
    }

    // Handle objects with properties
    if (schema.type === 'object' && schema.properties) {
      const propNames = Object.keys(schema.properties);

      // For response objects, generate inline type definitions
      if (propNames.length <= 5) {
        // Reasonable limit for inline types
        const propTypes = Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
          const propType = this.getTypeFromSchema(prop);
          return `${key}: ${propType}`;
        });
        return `{${propTypes.join('; ')}}`;
      }

      // For complex objects, return a generic object type
      return 'any';
    }

    // Handle other primitive types
    if (schema.type) {
      switch (schema.type) {
        case 'string':
          return 'string';
        case 'integer':
        case 'number':
          return 'number';
        case 'boolean':
          return 'boolean';
        case 'object':
          return 'any';
        default:
          return 'any';
      }
    }

    // Handle enum
    if (schema.enum) {
      return 'string'; // Could be expanded to union types
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf || schema.oneOf || schema.anyOf) {
      return 'any'; // Could be expanded to intersection/union types
    }

    return 'any';
  }

  /**
   * Get TypeScript type for request body
   */
  private getRequestBodyType(requestBody: any): string {
    if (!requestBody) return 'any';

    // Handle content types
    if (requestBody.content) {
      // Prefer application/json
      if (requestBody.content['application/json']?.schema) {
        return this.getTypeFromSchema(requestBody.content['application/json'].schema);
      }

      // Fall back to first available content type
      const firstContentType = Object.keys(requestBody.content)[0];
      if (requestBody.content[firstContentType]?.schema) {
        return this.getTypeFromSchema(requestBody.content[firstContentType].schema);
      }
    }

    return 'any';
  }

  /**
   * Add request body properties directly to options array (flatten the body)
   */
  private addRequestBodyProperties(requestBody: any, optionProps: string[]): void {
    if (!requestBody) return;

    let schema: any = null;

    // Get the schema from the request body
    if (requestBody.content) {
      // Prefer application/json
      if (requestBody.content['application/json']?.schema) {
        schema = requestBody.content['application/json'].schema;
      } else {
        // Fall back to first available content type
        const firstContentType = Object.keys(requestBody.content)[0];
        if (requestBody.content[firstContentType]?.schema) {
          schema = requestBody.content[firstContentType].schema;
        }
      }
    }

    if (!schema) return;

    // Handle $ref in schema
    if (schema.$ref) {
      const refType = this.resolveSchemaRef(schema.$ref);
      const referencedSchema = this.spec.components?.schemas?.[refType];
      if (referencedSchema && !('$ref' in referencedSchema)) {
        schema = referencedSchema;
      } else {
        // If we can't resolve the reference, fall back to the original type
        const bodyType = this.getRequestBodyType(requestBody);
        optionProps.push(`body?: ${bodyType}`);
        return;
      }
    }

    // If schema has properties, add them individually
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propType = this.getTypeFromSchema(propSchema as any);
        const required = (schema.required && schema.required.includes(propName)) || requestBody.required;
        const optional = required ? '' : '?';

        // Add description as comment if available
        const description = (propSchema as any)?.description;
        if (description) {
          // Clean up description for inline use
          const cleanDesc = description.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
          if (cleanDesc.length < 100) {
            // Only add short descriptions inline
            optionProps.push(`${propName}${optional}: ${propType} /** ${cleanDesc} */`);
          } else {
            optionProps.push(`${propName}${optional}: ${propType}`);
          }
        } else {
          optionProps.push(`${propName}${optional}: ${propType}`);
        }
      }
    } else {
      // If we can't extract individual properties, fall back to body wrapper
      const bodyType = this.getRequestBodyType(requestBody);
      optionProps.push(`body?: ${bodyType}`);
    }
  }

  /**
   * Get TypeScript type for response
   */
  private getResponseType(operation: OperationInfo): string {
    if (!operation.responses) return 'any';

    // Try success responses first (200, 201, etc.)
    const successCodes = ['200', '201', '202', '204'];
    for (const code of successCodes) {
      if (operation.responses[code]) {
        const response = operation.responses[code];
        if (response.content) {
          // Prefer application/json
          if (response.content['application/json']?.schema) {
            return this.getTypeFromSchema(response.content['application/json'].schema);
          }

          // Fall back to first available content type
          const firstContentType = Object.keys(response.content)[0];
          if (response.content[firstContentType]?.schema) {
            return this.getTypeFromSchema(response.content[firstContentType].schema);
          }
        }
      }
    }

    return 'any';
  }

  /**
   * Get TypeScript type for a parameter based on its schema
   */
  private getParameterType(param: any): string {
    if (param.schema) {
      return this.getTypeFromSchema(param.schema);
    }
    return 'any';
  }

  /**
   * Generate method implementation code for controller methods with discrete path parameters
   */
  private generateControllerMethodImplementation(operation: OperationInfo): string {
    const lines: string[] = [];
    const url = operation.path;
    const pathParams: string[] = [];
    const queryParams: string[] = [];
    const hasBody = !!operation.requestBody;

    // Check if method has any options (query params, body, or headers)
    const hasOptions = queryParams.length > 0 || hasBody;

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

    // Update hasOptions after we know about query params
    const actuallyHasOptions = queryParams.length > 0 || hasBody;

    // Always extract path parameters as discrete parameters when they exist
    if (pathParams.length > 0) {
      // Handle path parameters as discrete function parameters
      lines.push(`    let url = '${url}';`);
      for (const paramName of pathParams) {
        lines.push(`    if (${paramName}) {`);
        lines.push(`      url = url.replace('{${paramName}}', ${paramName});`);
        lines.push(`    }`);
      }
      lines.push('');

      // Build request body by excluding query parameters and headers (only if we have options)
      if (hasBody && actuallyHasOptions) {
        const excludedParams = ['headers', ...queryParams];
        const destructureList = excludedParams.join(', ');
        lines.push(`    const { ${destructureList}, ...bodyData } = options;`);
        lines.push(`    const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;`);
        lines.push('');
      }

      // Build fetch options
      lines.push(`    const fetchOptions: any = {`);
      lines.push(`      method: '${operation.method}',`);

      // Add query parameters
      if (queryParams.length > 0) {
        lines.push(`      params: {},`);
      }

      // Add body
      if (hasBody) {
        if (actuallyHasOptions) {
          lines.push(`      body: requestBody,`);
        } else {
          lines.push(`      body: undefined,`);
        }
      }

      // Add headers only if we have options
      if (actuallyHasOptions) {
        lines.push(`      headers: options?.headers,`);
      }

      lines.push(`    };`);
      lines.push('');

      // Add query parameters to options
      if (queryParams.length > 0) {
        lines.push(`    // Add query parameters`);
        for (const paramName of queryParams) {
          lines.push(`    if (options?.${paramName} !== undefined) {`);
          lines.push(`      fetchOptions.params.${paramName} = options.${paramName};`);
          lines.push(`    }`);
        }
        lines.push('');
      }
    } else {
      // No path parameters - check if we have options
      if (actuallyHasOptions) {
        lines.push(`    options = options || {};`);
        lines.push('');
      }
      lines.push(`    const url = '${url}';`);
      lines.push('');

      // Build request body by excluding query parameters and headers (only if we have options)
      if (hasBody && actuallyHasOptions) {
        const excludedParams = ['headers', ...queryParams];
        const destructureList = excludedParams.join(', ');
        lines.push(`    const { ${destructureList}, ...bodyData } = options;`);
        lines.push(`    const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;`);
        lines.push('');
      }

      // Build fetch options
      lines.push(`    const fetchOptions: any = {`);
      lines.push(`      method: '${operation.method}',`);

      // Add query parameters
      if (queryParams.length > 0) {
        lines.push(`      params: {},`);
      }

      // Add body
      if (hasBody) {
        if (actuallyHasOptions) {
          lines.push(`      body: requestBody,`);
        } else {
          lines.push(`      body: undefined,`);
        }
      }

      // Add headers only if we have options
      if (actuallyHasOptions) {
        lines.push(`      headers: options.headers,`);
      }

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
    }
    // Make the API call
    lines.push(`    return this.api.fetch(url, fetchOptions);`);

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

    // Extract path parameters as discrete parameters when no query params or body
    const isSimple = queryParams.length === 0 && !hasBody;

    if (isSimple && pathParams.length > 0) {
      // Handle path parameters as discrete function parameters
      lines.push(`  let url = '${url}';`);
      for (const paramName of pathParams) {
        lines.push(`  if (${paramName}) {`);
        lines.push(`    url = url.replace('{${paramName}}', ${paramName});`);
        lines.push(`  }`);
      }
      lines.push('');
      lines.push(`  return this.api.fetch(url, {`);
      lines.push(`    method: '${operation.method}',`);
      lines.push(`  });`);
    } else {
      // Options object pattern
      lines.push(`  options = options || {};`);
      lines.push('');

      // Replace path parameters - use discrete parameters, not options
      if (pathParams.length > 0) {
        lines.push(`  // Build URL with path parameters`);
        lines.push(`  let url = '${url}';`);
        for (const paramName of pathParams) {
          lines.push(`  if (${paramName}) {`);
          lines.push(`    url = url.replace('{${paramName}}', ${paramName});`);
          lines.push(`  }`);
        }
        lines.push('');
      } else {
        lines.push(`  const url = '${url}';`);
        lines.push('');
      }

      // Build request body by excluding query parameters and headers
      if (hasBody) {
        const excludedParams = ['headers', ...queryParams];
        const destructureList = excludedParams.join(', ');
        lines.push(`  const { ${destructureList}, ...bodyData } = options;`);
        lines.push(`  const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;`);
        lines.push('');
      }

      // Build fetch options
      lines.push(`  const fetchOptions: any = {`);
      lines.push(`    method: '${operation.method}',`);

      // Add query parameters
      if (queryParams.length > 0) {
        lines.push(`    params: {},`);
      }

      // Add body
      if (hasBody) {
        lines.push(`    body: requestBody,`);
      }

      // Add headers
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
    }
    // Make the API call
    lines.push(`    return this.api.fetch(url, fetchOptions);`);

    return lines.join('\n');
  }

  /**
   * Generate exposed resource methods for API introspection
   */
  generateExposedResourceMethods(
    resources: Array<{className: string; fileName: string}>,
    resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>
  ): string {
    const methods: string[] = [];

    for (const resource of resources) {
      const resourceName = resource.fileName;

      // Find the corresponding spec for this resource
      const resourceSpec = resourceSpecs?.find((rs) => rs.fileName === resourceName);

      if (resourceSpec) {
        // Create a temporary generator for this resource's spec
        const resourceGenerator = new OpenAPIToConnector(resourceSpec.spec, resourceName);
        const operations = resourceGenerator.extractOperations();

        for (const operation of operations) {
          const methodName = resourceGenerator.generateMethodName(operation);
          const jsdoc = resourceGenerator.generateDetailedJSDoc(operation);
          const signature = resourceGenerator.generateMethodSignature(operation);

          // Generate the exposed method that delegates to the resource
          const exposedMethodName = `${resourceName}${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`;

          // Generate parameter call based on operation details
          const parameterCall = this.generateParameterCallForOperation(operation, signature);

          methods.push(`  /**
${jsdoc}
   */
  async ${exposedMethodName}${signature} {
    return this.${resourceName}.${methodName}(${parameterCall});
  }`);
        }
      }
    }

    return methods.join('\n\n');
  }

  /**
   * Generate parameter call for a specific operation based on path parameters
   */
  private generateParameterCallForOperation(operation: OperationInfo, signature: string): string {
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

    // Extract parameter names from controller signature
    const paramMatch = signature.match(/\(([^)]+)\)/);
    if (!paramMatch || paramMatch[1].trim() === '') return '';

    const allParams = paramMatch[1]
      .split(',')
      .map((p) => {
        const paramName = p.trim().split(':')[0].trim();
        return paramName.replace(/[?]/g, '');
      })
      .filter((p) => p.length > 0);

    // Check if signature actually has options parameter
    const hasOptionsParam = allParams.includes('options');

    // Always extract path parameters as discrete parameters when they exist
    if (pathParams.length > 0) {
      // Path parameters are discrete, options is the last parameter (if it exists)
      const pathParamNames = pathParams;
      if (hasOptionsParam) {
        return [...pathParamNames, 'options'].join(', ');
      } else {
        return pathParamNames.join(', ');
      }
    } else {
      // No path parameters, everything goes in options object (if options exists)
      if (hasOptionsParam) {
        return allParams[0] || 'options';
      } else {
        return '';
      }
    }
  }

  /**
   * Generate TypeScript interface from OpenAPI schema
   */
  private generateInterfaceFromSchema(name: string, schema: any): string {
    if (!schema) return '';

    const sanitizedName = this.sanitizeTypeName(name);
    const lines: string[] = [];
    lines.push(`export interface ${sanitizedName} {`);

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propType = this.getTypeFromSchema(propSchema as any);
        const required = schema.required && schema.required.includes(propName);
        const optional = required ? '' : '?';

        // Add description as comment if available
        const description = (propSchema as any)?.description;
        if (description) {
          lines.push(`  /** ${description} */`);
        }

        lines.push(`  ${propName}${optional}: ${propType};`);
      }
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      lines.push(
        `  // Inherits from: ${schema.allOf.map((s: any) => (s.$ref ? this.resolveSchemaRef(s.$ref) : 'unknown')).join(', ')}`
      );
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate all TypeScript interfaces from OpenAPI components
   */
  private generateAllInterfaces(): string {
    if (!this.spec.components?.schemas) {
      return '';
    }

    const interfaces: string[] = [];
    const usedTypes = this.collectUsedSchemaTypes();

    for (const [schemaName, schema] of Object.entries(this.spec.components.schemas)) {
      const sanitizedSchemaName = this.sanitizeTypeName(schemaName);
      if (usedTypes.has(sanitizedSchemaName)) {
        const interfaceCode = this.generateInterfaceFromSchema(schemaName, schema);
        if (interfaceCode) {
          interfaces.push(interfaceCode);
        }
      }
    }

    if (interfaces.length === 0) {
      return '';
    }

    return `// Generated TypeScript interfaces from OpenAPI schemas\n\n${interfaces.join('\n\n')}\n`;
  }

  /**
   * Generate detailed JSDoc with schema field information
   */
  private generateDetailedJSDoc(operation: OperationInfo): string {
    const lines: string[] = [];
    lines.push(` * ${operation.summary || operation.operationId || 'API Operation'}`);

    if (operation.description) {
      lines.push(' *');
      // Split long descriptions into multiple lines
      const descLines = operation.description.split('\n');
      descLines.forEach((line) => {
        lines.push(` * ${line}`);
      });
    }

    lines.push(' *');

    // Document path parameters with details
    const pathParams: any[] = [];
    const queryParams: any[] = [];

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

    // Document discrete path parameters
    pathParams.forEach((param) => {
      const paramType = this.getParameterType(param);
      const paramDesc = param.description || '';
      lines.push(` * @param {${paramType}} ${param.name} ${paramDesc}`);
    });

    // Document options parameter with detailed schema information
    if (queryParams.length > 0 || operation.requestBody) {
      lines.push(' * @param {Object} options - Request options');

      // Document query parameters
      queryParams.forEach((param) => {
        const paramType = this.getParameterType(param);
        const paramDesc = param.description || '';
        const required = param.required ? '(required)' : '(optional)';
        lines.push(` * @param {${paramType}} options.${param.name} ${required} - ${paramDesc} [query]`);
      });

      // Document request body with detailed schema info (now flattened)
      if (operation.requestBody) {
        this.addFlattenedBodyDocumentation(lines, operation.requestBody);
      }
    } else if (pathParams.length > 0) {
      lines.push(` * @param {Object} options (optional) - Request options`);
    }

    // Document response with detailed schema information
    lines.push(' *');
    const returnType = this.getResponseType(operation);
    lines.push(` * @returns {Promise<${returnType}>} ${operation.method.toUpperCase()} ${operation.path} response`);

    // Add detailed schema information for the return type
    this.addSchemaDetails(lines, returnType, 'response');

    return lines.join('\n');
  }

  /**
   * Add flattened request body documentation to JSDoc
   */
  private addFlattenedBodyDocumentation(lines: string[], requestBody: any): void {
    if (!requestBody) return;

    let schema: any = null;

    // Get the schema from the request body
    if (requestBody.content) {
      if (requestBody.content['application/json']?.schema) {
        schema = requestBody.content['application/json'].schema;
      } else {
        const firstContentType = Object.keys(requestBody.content)[0];
        if (requestBody.content[firstContentType]?.schema) {
          schema = requestBody.content[firstContentType].schema;
        }
      }
    }

    if (!schema) return;

    // Handle $ref in schema
    if (schema.$ref) {
      const refType = this.resolveSchemaRef(schema.$ref);
      const referencedSchema = this.spec.components?.schemas?.[refType];
      if (referencedSchema && !('$ref' in referencedSchema)) {
        schema = referencedSchema;
      } else {
        // Fallback to original format if we can't resolve
        const bodyType = this.getRequestBodyType(requestBody);
        const bodyDesc = requestBody.description || 'Request body';
        const required = requestBody.required ? '(required)' : '(optional)';
        lines.push(` * @param {${bodyType}} options.body ${required} - ${bodyDesc}`);
        return;
      }
    }

    // Document individual properties from the body schema
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propType = this.getTypeFromSchema(propSchema as any);
        const propRequired = (schema.required && schema.required.includes(propName)) || requestBody.required;
        const requiredText = propRequired ? '(required)' : '(optional)';
        const propDesc = (propSchema as any)?.description || '';

        lines.push(` * @param {${propType}} options.${propName} ${requiredText} - ${propDesc} [body property]`);
      }
    } else {
      // Fallback to original format if no properties
      const bodyType = this.getRequestBodyType(requestBody);
      const bodyDesc = requestBody.description || 'Request body';
      const required = requestBody.required ? '(required)' : '(optional)';
      lines.push(` * @param {${bodyType}} options.body ${required} - ${bodyDesc}`);
    }
  }

  /**
   * Add detailed schema field information to JSDoc
   */
  private addSchemaDetails(lines: string[], typeName: string, context: string): void {
    // Remove array notation to get base type
    const baseType = typeName.replace(/\[\]$/, '');
    const isArray = typeName.endsWith('[]');

    if (['string', 'number', 'boolean', 'any'].includes(baseType)) {
      return; // Skip primitive types
    }

    const schema = this.spec.components?.schemas?.[baseType];
    if (!schema) {
      return;
    }

    // Type guard to check if schema has properties (is not a ReferenceObject)
    if ('$ref' in schema) {
      return; // Skip reference objects
    }

    if (!schema.properties) {
      return;
    }

    lines.push(' *');
    lines.push(` * ${context}${isArray ? '[]' : ''} fields:`);

    const maxFields = 10; // Limit to avoid too much clutter
    const properties = Object.entries(schema.properties).slice(0, maxFields);

    for (const [propName, propSchema] of properties) {
      const propType = this.getTypeFromSchema(propSchema as any);
      const required = schema.required && schema.required.includes(propName);
      const requiredText = required ? '' : '?';
      const description = (propSchema as any)?.description;

      if (description) {
        lines.push(` * - ${propName}${requiredText}: ${propType} - ${description}`);
      } else {
        lines.push(` * - ${propName}${requiredText}: ${propType}`);
      }
    }

    const totalFields = Object.keys(schema.properties).length;
    if (totalFields > maxFields) {
      lines.push(` * - ... and ${totalFields - maxFields} more fields`);
    }
  }

  /**
   * Collect all schema types used in operations (including nested references)
   */
  private collectUsedSchemaTypes(): Set<string> {
    const usedTypes = new Set<string>();
    const visitedSchemas = new Set<string>(); // Track visited schemas to prevent infinite recursion
    const operations = this.extractOperations();

    for (const operation of operations) {
      // Collect from request body schemas
      if (operation.requestBody) {
        this.collectTypesFromRequestBody(operation.requestBody, usedTypes, visitedSchemas);
      }

      // Collect from response schemas
      if (operation.responses) {
        this.collectTypesFromResponses(operation.responses, usedTypes, visitedSchemas);
      }

      // Collect from parameter schemas
      if (operation.parameters) {
        for (const param of operation.parameters) {
          if (typeof param === 'object' && 'schema' in param && param.schema) {
            this.collectTypesFromSchema(param.schema, usedTypes, visitedSchemas);
          }
        }
      }
    }

    return usedTypes;
  }

  /**
   * Collect types from request body schema
   */
  private collectTypesFromRequestBody(requestBody: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!requestBody || !requestBody.content) return;

    // Check all content types
    for (const contentType of Object.keys(requestBody.content)) {
      const content = requestBody.content[contentType];
      if (content.schema) {
        this.collectTypesFromSchema(content.schema, usedTypes, visitedSchemas);
      }
    }
  }

  /**
   * Collect types from response schemas
   */
  private collectTypesFromResponses(responses: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!responses) return;

    // Check success responses
    const successCodes = ['200', '201', '202', '204'];
    for (const code of successCodes) {
      const response = responses[code];
      if (response && response.content) {
        for (const contentType of Object.keys(response.content)) {
          const content = response.content[contentType];
          if (content.schema) {
            this.collectTypesFromSchema(content.schema, usedTypes, visitedSchemas);
          }
        }
      }
    }
  }

  /**
   * Collect types from a schema object
   */
  private collectTypesFromSchema(schema: any, usedTypes: Set<string>, visitedSchemas: Set<string>): void {
    if (!schema) return;

    // Handle $ref
    if (schema.$ref) {
      const parts = schema.$ref.split('/');
      const originalSchemaName = parts[parts.length - 1];
      const sanitizedRefType = this.resolveSchemaRef(schema.$ref);

      if (sanitizedRefType !== 'any' && !['string', 'number', 'boolean'].includes(sanitizedRefType)) {
        // Add the sanitized type name to used types
        usedTypes.add(sanitizedRefType);

        // Only recurse if we haven't visited this schema before (use original name for lookup)
        if (!visitedSchemas.has(originalSchemaName)) {
          visitedSchemas.add(originalSchemaName);
          const referencedSchema = this.spec.components?.schemas?.[originalSchemaName];
          if (referencedSchema) {
            this.collectTypesFromSchema(referencedSchema, usedTypes, visitedSchemas);
          }
        }
      }
      return;
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      this.collectTypesFromSchema(schema.items, usedTypes, visitedSchemas);
      return;
    }

    // Handle objects with properties
    if (schema.type === 'object' && schema.properties) {
      for (const propSchema of Object.values(schema.properties)) {
        this.collectTypesFromSchema(propSchema, usedTypes, visitedSchemas);
      }
      return;
    }

    // Handle allOf, oneOf, anyOf
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }

    if (schema.oneOf) {
      for (const subSchema of schema.oneOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }

    if (schema.anyOf) {
      for (const subSchema of schema.anyOf) {
        this.collectTypesFromSchema(subSchema, usedTypes, visitedSchemas);
      }
    }
  }

  /**
   * Generate type imports for used schema types
   */
  private generateTypeImports(): string {
    const usedTypes = this.collectUsedSchemaTypes();
    if (usedTypes.size === 0) {
      return '';
    }

    const typeList = Array.from(usedTypes).sort().join(', ');
    return `// Type imports (you may need to adjust the import path)\n// import type { ${typeList} } from './types';\n\n`;
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
        const jsdoc = this.generateDetailedJSDoc(operation);
        const signature = this.generateMethodSignature(operation);
        const implementation = this.generateResourceFunctionImplementation(operation);

        return `/**\n${jsdoc}\n */\nexport function ${methodName}(this: any, ${signature.replace('(', '').replace(')', '')}) {\n${implementation}\n}`;
      })
      .join('\n\n');

    // Generate actual TypeScript interfaces
    const interfaces = this.generateAllInterfaces();

    return `// ${className} resource functions
// These functions will be bound to the controller instance and accessible as ${resourceName}.method()

${interfaces}

${functions}`;
  }

  /**
   * Generate a main controller that composes multiple resources using function binding
   */
  generateMainController(
    resources: Array<{className: string; fileName: string}>,
    resourceSpecs?: Array<{fileName: string; spec: OpenAPIV3.Document}>
  ): string {
    // Get base URL from servers if available
    const baseUrl =
      this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'https://api.example.com';

    const imports = resources
      .map((resource) => `import * as ${resource.fileName}Functions from '../resources/${resource.fileName}.mjs';`)
      .join('\n');

    const properties = resources.map((resource) => `  ${resource.fileName}: any = {};`).join('\n');

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
   * Generate the connector controller code with improved pattern
   */
  generateController(): string {
    const operations = this.extractOperations();

    if (operations.length === 0) {
      throw new Error('No operations found in OpenAPI specification');
    }

    const methods = operations
      .map((operation) => {
        const methodName = this.generateMethodName(operation);
        const jsdoc = this.generateDetailedJSDoc(operation); // Use detailed JSDoc like multi-resource
        const signature = this.generateMethodSignature(operation);
        const implementation = this.generateControllerMethodImplementation(operation); // Use improved implementation

        return `  /**\n${jsdoc}\n   */\n  async ${methodName}${signature} {\n${implementation}\n  }`;
      })
      .join('\n\n');

    // Get base URL from servers if available
    const baseUrl =
      this.spec.servers && this.spec.servers.length > 0 ? this.spec.servers[0].url : 'https://api.example.com';

    // Generate TypeScript interfaces
    const interfaces = this.generateAllInterfaces();

    // Generate type imports
    const typeImports = this.generateTypeImports();

    const startMethod = `  private api: any;

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
  }`;

    return `import {AbstractController} from '@aloma.io/integration-sdk';

${typeImports}${interfaces}export default class Controller extends AbstractController {
  
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
