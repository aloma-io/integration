# OpenAPI to Connector Generator

A deterministic script that generates Aloma connector controllers from OpenAPI 3.x specifications.

## Features

### Core Generation
- ✅ **Deterministic**: Same OpenAPI input always produces the same connector definition
- ✅ **No LLM involvement**: Pure parsing and code generation
- ✅ **OpenAPI 3.x support**: Validates against OpenAPI 3.x schema
- ✅ **JSON & YAML support**: Handles both JSON and YAML OpenAPI specifications
- ✅ **Comprehensive coverage**: Generates methods for all endpoints and operations

### TypeScript & Code Quality
- ✅ **TypeScript Interface Generation**: Automatically generates interfaces from OpenAPI schemas
- ✅ **Schema Name Sanitization**: Converts invalid names (e.g., `Complex.Name.With.Dots` → `Complex_Name_With_Dots`)
- ✅ **Clean Parameter Handling**: No unnecessary options parameters for simple methods
- ✅ **Path Parameter Separation**: Discrete path parameters with optional options object
- ✅ **Inline Body Construction**: Direct body building without helper methods

### Documentation & Usability
- ✅ **Rich JSDoc Generation**: Detailed documentation with parameter descriptions and examples
- ✅ **Schema Field Documentation**: Documents response object fields and properties
- ✅ **Parameter Type Documentation**: Includes TypeScript types in JSDoc comments
- ✅ **Controller-Only Mode**: Generate just the controller file for existing projects

### Architecture Support
- ✅ **Multi-Resource Architecture**: Support for complex APIs with multiple resource groups
- ✅ **Resource Function Pattern**: Functions bound to controller context for proper introspection
- ✅ **API Introspection**: Exposed methods for framework compatibility
- ✅ **Error handling**: Clear error messages for invalid specifications

## Installation

The script is included in the integration-sdk package. Install dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

## Usage

### CLI Usage (Recommended)

After deploying to npm, you can use the integrated CLI command:

```bash
# Create a complete connector project from OpenAPI spec
npx @aloma.io/integration-sdk@latest from-openapi "My Connector" --connector-id "my-connector-123" --spec api.yaml

# With custom output path
npx @aloma.io/integration-sdk@latest from-openapi "My Connector" --connector-id "my-connector-123" --spec api.yaml --out src/controller/index.mts

# Controller-only mode (NEW!) - Generate just the controller file
npx @aloma.io/integration-sdk@latest from-openapi "My Connector" \
  --connector-id "my-connector-123" \
  --spec api.yaml \
  --controller-only \
  --out "./src/controller/index.mts"

# Multi-resource connector
npx @aloma.io/integration-sdk@latest create-multi-resource "My Connector" \
  --connector-id "my-connector-123" \
  --resources "ProductsResource:products.json,OrdersResource:orders.json" \
  --base-url "https://api.example.com"
```

#### Options

- `<name>` (required): Name of the connector project
- `--connector-id <id>` (required): ID of the connector
- `--spec <file>` (required): OpenAPI specification file (JSON or YAML)
- `--out <file>` (optional): Output file path for the controller (default: `src/controller/index.mts`)
- `--controller-only` (optional): Generate only the controller file, no project structure
- `--resource <className>` (optional): Generate as a resource class instead of controller
- `--no-build` (optional): Skip installing dependencies and building the project

### Standalone Script Usage

You can also use the standalone script directly:

```bash
node ./build/openapi-to-connector.mjs generate --name "My Connector" --spec api.yaml --out controller.mts
```

#### Options

- `--name <name>` (required): Human-readable connector name
- `--spec <file>` (required): OpenAPI specification file (JSON or YAML)
- `--out <file>` (optional): Output file path (default: `index.mts`)

### Programmatic Usage

```typescript
import { OpenAPIToConnector } from './build/openapi-to-connector.mjs';

// Parse OpenAPI spec
const spec = OpenAPIToConnector.parseSpec(specString);

// Generate controller
const generator = new OpenAPIToConnector(spec, 'My Connector');
const controllerCode = generator.generateController();
```

## Example

### Input: OpenAPI Specification

```yaml
openapi: 3.0.0
info:
  title: User API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      parameters:
        - name: page
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: Success
    post:
      operationId: createUser
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Created
```

### Output: Generated Controller

```typescript
import {AbstractController} from '@aloma.io/integration-sdk';

// Generated TypeScript interfaces from OpenAPI schemas

export interface User {
  id: string;
  name: string;
  email?: string;
  createdAt: string;
}

export interface UserList {
  users: User[];
  total: number;
  hasMore: boolean;
}

export default class Controller extends AbstractController {
  
  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;
    
    this.api = this.getClient({
      baseUrl: 'https://api.example.com',
      customize(request) {
        request.headers ||= {};
        // Add authentication headers based on your API requirements
        // Example: request.headers["Authorization"] = `Bearer ${config.apiToken}`;
      },
    });
  }

  /**
   * List all users
   *
   * @param {Object} options - Request options
   * @param {number} options.page (optional) - Page number for pagination [query]
   *
   * @returns {Promise<UserList>} GET /users response
   *
   * response fields:
   * - users: User[] - Array of user objects
   * - total: number - Total number of users
   * - hasMore: boolean - Whether there are more users available
   */
  async listUsers(options?: {page?: number}) {
    options = options || {};

    const url = '/users';

    const fetchOptions: any = {
      method: 'GET',
      params: {},
      headers: options.headers,
    };

    // Add query parameters
    if (options.page !== undefined) {
      fetchOptions.params.page = options.page;
    }

    return this.api.fetch(url, fetchOptions);
  }

  /**
   * Create user
   *
   * @param {Object} options - Request options
   * @param {string} options.name (required) - User's full name [body property]
   * @param {string} options.email (optional) - User's email address [body property]
   *
   * @returns {Promise<User>} POST /users response
   */
  async createUser(options: {name: string, email?: string}) {
    options = options || {};

    const url = '/users';

    const { headers, ...bodyData } = options;
    const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;

    const fetchOptions: any = {
      method: 'POST',
      body: requestBody,
      headers: options.headers,
    };

    return this.api.fetch(url, fetchOptions);
  }
}
```

## Generated Method Names

The script generates method names using the following priority:

1. **Operation ID**: If `operationId` is present, use it directly
2. **Method + Path**: Combine HTTP method with path segments
   - `GET /users` → `getUsers`
   - `POST /users/{id}/posts` → `post_users_{id}_posts`

## Parameter Mapping

- **Path parameters**: Mapped to `args.paramName`
- **Query parameters**: Mapped to `args.paramName`
- **Request body**: Mapped to `args.body`
- **Headers**: Mapped to `args.headerName`

## JSDoc Generation

The script generates comprehensive JSDoc comments using:

- **Summary**: From `operation.summary`
- **Description**: From `operation.description`
- **Parameters**: From `operation.parameters` with descriptions
- **Request body**: When present
- **Return type**: Always includes `@returns Response data`

## Error Handling

The script provides clear error messages for:

- Invalid JSON/YAML syntax
- Non-OpenAPI 3.x specifications
- Missing required fields (`openapi`, `info`, `paths`)
- Empty specifications (no operations)

## Testing

### Comprehensive Scenario Tests

The SDK includes comprehensive scenario tests that verify the complete code generation pipeline:

```bash
# Run all scenario tests with fixtures
npm run test:scenarios

# Run all tests (including unit tests)
npm run test:all
```

### Test Coverage

The scenario tests verify:
- ✅ **Complete code generation** from OpenAPI specs to connector code
- ✅ **TypeScript interface generation** with proper schema sanitization
- ✅ **Clean parameter handling** (no unnecessary options for simple methods)
- ✅ **Multi-resource architecture** with resource binding and exposure
- ✅ **Schema name sanitization** (e.g., `Complex.Name.With.Dots` → `Complex_Name_With_Dots`)
- ✅ **Path parameter separation** from options object
- ✅ **JSDoc generation** with detailed parameter documentation
- ✅ **Regression protection** against common code generation issues

### Test Scenarios
- **Simple Scenario**: Basic single-controller generation using `examples/simple-api.json`
- **Complex Scenario**: Multi-resource generation with Products + Orders APIs
- **Regression Tests**: Edge cases, schema sanitization, and clean code generation

All tests compare generated output against fixtures to ensure deterministic, high-quality code generation.

### Manual Testing

```bash
# Test with sample API
node ./build/openapi-to-connector.mjs generate --name "Sample API" --spec ./examples/sample-api.yaml --out ./test-output.mts

# Test controller-only mode
node build/cli.mjs from-openapi test-connector \
  --connector-id "test" \
  --spec "examples/simple-api.json" \
  --controller-only \
  --out "./test-controller.mts"
```

## Requirements Met

✅ **Runnable script**: CLI with proper argument parsing  
✅ **OpenAPI 3.x support**: Validates and parses OpenAPI 3.x specs  
✅ **JSON/YAML support**: Handles both formats  
✅ **Deterministic**: Same input always produces same output  
✅ **No inference**: Fails fast on missing information  
✅ **Full coverage**: Generates methods for all operations  
✅ **Rich documentation**: Uses all available descriptions  
✅ **Testing**: Includes unit tests for core functionality  

## Integration with Aloma SDK

The generated controller extends `AbstractController` and follows the Aloma connector pattern:

- Each OpenAPI operation becomes a public async method
- Methods receive `args` parameter with all request data
- Methods should return response data or throw errors
- JSDoc comments provide rich documentation for the UI

The generated controller can be used directly in an Aloma connector project after implementing the actual API calls.
