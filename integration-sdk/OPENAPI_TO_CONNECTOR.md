# OpenAPI to Connector Generator

A deterministic script that generates Aloma connector controllers from OpenAPI 3.x specifications.

## Features

- ✅ **Deterministic**: Same OpenAPI input always produces the same connector definition
- ✅ **No LLM involvement**: Pure parsing and code generation
- ✅ **OpenAPI 3.x support**: Validates against OpenAPI 3.x schema
- ✅ **JSON & YAML support**: Handles both JSON and YAML OpenAPI specifications
- ✅ **Comprehensive coverage**: Generates methods for all endpoints and operations
- ✅ **Rich documentation**: Uses OpenAPI descriptions and summaries for JSDoc comments
- ✅ **Parameter mapping**: Maps OpenAPI parameters to method arguments
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
```

#### Options

- `<name>` (required): Name of the connector project
- `--connector-id <id>` (required): ID of the connector
- `--spec <file>` (required): OpenAPI specification file (JSON or YAML)
- `--out <file>` (optional): Output file path for the controller (default: `src/controller/index.mts`)

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

export default class Controller extends AbstractController {
  
  /**
   * List all users
   *
   * @param args - Request arguments
   * @param args.page - Page number for pagination
   * @returns Response data
   */
  async listUsers(args: any) {
    // TODO: Implement GET /users
    throw new Error('Method not implemented');
  }

  /**
   * Create user
   *
   * @param args.body - Request body
   * @returns Response data
   */
  async createUser(args: any) {
    // TODO: Implement POST /users
    throw new Error('Method not implemented');
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

Run the included tests:

```bash
npm test
```

Or test manually:

```bash
# Test with sample API
node ./build/openapi-to-connector.mjs generate --name "Sample API" --spec ./examples/sample-api.yaml --out ./test-output.mts
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
