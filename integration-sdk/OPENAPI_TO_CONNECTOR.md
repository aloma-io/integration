# OpenAPI to Connector Generator

A deterministic script that generates Aloma connector controllers from OpenAPI 3.x specifications.

## Features

### Core Generation
- ✅ **Deterministic**: Same OpenAPI input always produces the same connector definition
- ✅ **No LLM involvement**: Pure parsing and code generation
- ✅ **OpenAPI 3.x support**: Validates against OpenAPI 3.x schema
- ✅ **JSON & YAML support**: Handles both JSON and YAML OpenAPI specifications
- ✅ **Whole spec**: every operation in the spec becomes exactly one method; anything not fully supported is reported by operation, never dropped silently

### TypeScript & Code Quality
- ✅ **TypeScript Interface Generation**: Automatically generates interfaces from OpenAPI schemas
- ✅ **Schema Name Sanitization**: Converts invalid names (e.g., `Complex.Name.With.Dots` → `Complex_Name_With_Dots`)
- ✅ **One argument object**: every method takes a single object, as the connector runtime calls `method(args, ctx)`; path, query and header parameters and body fields are its keys
- ✅ **Correct requests**: path values encoded, query parameters serialised per the spec's `style`/`explode`, header parameters sent as headers, path-level and `$ref` parameters included (built by `callOperation` in the SDK)
- ✅ **Safe output**: text from the spec is escaped, so a spec cannot inject code into the connector

### Documentation & Usability
- ✅ **Rich JSDoc Generation**: Detailed documentation with parameter descriptions and examples
- ✅ **Schema Field Documentation**: Documents response object fields and properties
- ✅ **Parameter Type Documentation**: Includes TypeScript types in JSDoc comments
- ✅ **Controller-Only Mode**: Generate just the controller file for existing projects
- ✅ **Doc page and command reference**: setup, the exact call syntax for every method, and a link to the provider's reference for what each call does
- ✅ **Contract tests**: one per operation (method, path, query, body, headers), run offline with `runContract`

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
- `--nested-paths` / `--no-nested-paths` (optional): Dotted method names from the URL, e.g. `crm.contacts.getById`. Without either flag, APIs with 50 or more operations (counted across all resources) get dotted names and smaller ones keep flat names
- `--reference-url <template>` (optional): Provider reference link per operation when the spec has none, with `{operationId}`, `{method}` and `{path}` placeholders
- `--reference-fallback <url>` (optional): Link for methods with no more specific reference, e.g. the provider's API overview. Links are taken in this order: the operation's own, the template, its tag's, the spec's, then this fallback
- `--no-build` (optional): Skip installing dependencies and building the project

#### What a generated project contains

Besides `src/controller/index.mts` (and `src/resources/*.mts` for multi-resource connectors):

- `src/auth.mts`: how the connector authenticates (hand-written; written once, never overwritten), used by `src/index.mts` and the controller
- `openapi-report.json`: operations in the spec, operations generated, and every limitation by operation
- `docs/connector.md`: the documentation page (setup, usage, every method with its call syntax and provider link)
- `docs/commands.json`: the same content, machine-readable, for AI step generation
- `test/contract.json` and `test/contract.test.mjs`: the contract test, run by `yarn test` after `yarn build`

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
servers:
  - url: https://api.example.com
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      parameters:
        - name: page
          in: query
          description: Page number for pagination
          schema:
            type: integer
      responses:
        '200':
          description: Success
  /users/{userId}:
    patch:
      operationId: updateUser
      summary: Update a user
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
                  description: User's full name
                email:
                  type: string
                  description: User's email address
      responses:
        '200':
          description: Success
```

### Output: Generated Controller

```typescript
import {AbstractController, callOperation} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';


const OPERATIONS: {[name: string]: OperationDescriptor} = {
  "listUsers": {"method":"GET","path":"/users","pathParams":[],"query":[{"name":"page"}],"headers":[],"body":null},
  "updateUser": {"method":"PATCH","path":"/users/{userId}","pathParams":["userId"],"query":[],"headers":[],"body":{"mode":"flat","contentType":"application/json","fields":["name","email"]}},
};

export default class Controller extends AbstractController {
  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;

    this.api = this.getClient({
      baseUrl: "https://api.example.com",
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
   * GET /users
   *
   * @param {number} page (optional) - Page number for pagination [query]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.myConnector.listUsers({})
   * ```
   *
   * @returns {Promise<any>} GET /users response
   */
  async listUsers({page, headers}: {page?: number; headers?: Record<string, string>} = {}) {
    return callOperation(this.api, OPERATIONS.listUsers, {page, headers});
  }

  /**
   * Update a user
   *
   * PATCH /users/{userId}
   *
   * @param {string} userId (required) -  [path]
   * @param {string} name (required) - User's full name [body]
   * @param {string} email (optional) - User's email address [body]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.myConnector.updateUser({ userId: "userId-1", name: "name-value" })
   * ```
   *
   * @returns {Promise<any>} PATCH /users/{userId} response
   */
  async updateUser({userId, name, email, headers}: {userId: string; name: string; email?: string; headers?: Record<string, string>}) {
    return callOperation(this.api, OPERATIONS.updateUser, {userId, name, email, headers});
  }
}
```

A step calls these as `await connectors.myConnector.updateUser({userId: '42', name: 'Ada'})`.

## Authentication

Generated code makes the requests; `src/auth.mts` says where the credential comes from. It exports an `AuthPlan`:

```typescript
import type {AuthPlan} from '@aloma.io/integration-sdk';

const auth: AuthPlan = {
  // OAuth 2.0 authorization code flow, run by the SDK runtime (connect, refresh, storage).
  // The client id and secret come from OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET where the connector runs.
  oauth: {
    authorizationURL: 'https://example.com/oauth/authorize?client_id={{clientId}}&redirect_uri={{redirectURI}}&scope={{scope}}',
    tokenURL: 'https://example.com/oauth/token',
    scope: 'contacts.read contacts.write',
  },
  // An access token from the connector's configuration, sent as "Authorization: Bearer <token>".
  token: {field: 'apiToken', name: 'API token'},
};

export default auth;
```

- With both, an install can connect with OAuth or set a token; a configured token is used instead of OAuth.
- With a token only, a request without a configured token is refused before it is sent.
- `hubspotAuth` is a ready plan for HubSpot (OAuth through the app, or a private app access token): `export {hubspotAuth as default} from '@aloma.io/integration-sdk';`.

## Generated Method Names

The script generates method names using the following priority:

1. **Operation ID**: If `operationId` is present, use it directly
2. **Method + Path**: Combine HTTP method with path segments
   - `GET /users` → `getUsers`
   - `POST /users/{id}/posts` → `post_users_{id}_posts`

When two operations would get the same name, the later one takes a word from its path (`batchCreate`), then a number. Names never clash with the controller's own methods (`start`, `request`, ...) or, with `--nested-paths`, with the namespace of other methods.

## Parameter Mapping

All are keys of the method's one argument object:

- **Path parameters**: required; the value is URL-encoded into the path. A missing value is refused before any request
- **Query parameters**: serialised per `style` and `explode` (arrays repeated or comma-joined, `deepObject` as `name[key]`)
- **Header parameters**: sent as request headers; `headers` adds any other headers
- **Request body**: an object schema's fields are keys of the argument object; any other body (array, multipart, a field that clashes with a parameter name) is passed as `body`
- **Names that are not identifiers** (`filter[name]`, `X-Request-Id`) become `filter_name`, `X_Request_Id`; the docs show both
- **Cookie parameters** are not supported and are listed in the report

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

### Contract tests in generated connectors

Every generated connector ships `test/contract.json`: for each operation, the arguments a test passes and the exact request the method must make. `runContract(controller, contract)` calls each method the way the connector runtime does, with a recording client and no network, and returns any operation whose request differs. `assertParamEffect` is the live smoke check: it fails when changing a parameter (for example `limit`) changes nothing in the response.

### Test Coverage

The scenario tests verify:
- ✅ **Complete code generation** from OpenAPI specs to connector code
- ✅ **TypeScript interface generation** with proper schema sanitization
- ✅ **Generated connectors called as the runtime calls them** (query, path encoding, ids, bodies, headers)
- ✅ **Whole-spec coverage**: method list equals the spec's operation list
- ✅ **Multi-resource architecture** with resource binding and exposure
- ✅ **Schema name sanitization** (e.g., `Complex.Name.With.Dots` → `Complex_Name_With_Dots`)
- ✅ **Rate limits**: 429 retries are capped and honour `Retry-After` (up to 60 s)
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
- Methods receive one `args` object with all request data, as the runtime passes it
- Methods return response data or throw errors
- JSDoc comments provide rich documentation for the UI and introspection

Generated connectors need the SDK version that provides `callOperation`. Authentication is not generated: add it in `start()` (the `customize` hook), as the comment there shows.
