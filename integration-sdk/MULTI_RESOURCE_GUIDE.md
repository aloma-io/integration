# Multi-Resource Connector Guide

This guide explains how to create and manage multi-resource connectors using the Aloma Integration SDK.

## Overview

Multi-resource connectors allow you to organize large APIs into logical resource groups (e.g., `companies`, `contacts`, `deals`) while maintaining a clean, modular architecture. Each resource is generated from its own OpenAPI specification and composed in a main controller.

## Architecture

```
src/
├── controller/
│   └── index.mts          # Main controller (extends AbstractController)
└── resources/
    ├── companies.mts      # CompaniesResource (plain class)
    ├── contacts.mts       # ContactsResource (plain class)
    └── lists.mts          # ListsResource (plain class)
```

### Main Controller
- Extends `AbstractController`
- Has `private api: any` and `protected async start()`
- Composes all resources
- Initializes API client once

### Resource Classes
- Plain TypeScript classes (no inheritance)
- Receive controller reference in constructor
- Access `api` via getter: `this.controller['api']`
- Focus on their specific domain

## Creating Multi-Resource Connectors

### 1. Create from Multiple OpenAPI Specs

```bash
npx @aloma.io/integration-sdk@latest create-multi-resource "MyConnector" \
  --connector-id "my-connector-123" \
  --resources "CompaniesResource:companies.json,ContactsResource:contacts.json,ListsResource:lists.json" \
  --base-url "https://api.example.com"
```

**Parameters:**
- `--resources`: Comma-separated list of `ClassName:specFile` pairs
- `--base-url`: API base URL (optional, extracted from first spec if not provided)
- `--no-build`: Skip dependency installation and building

### 2. Resource Specification Format

The `--resources` parameter accepts a comma-separated list in this format:
```
"ClassName1:specFile1,ClassName2:specFile2,ClassName3:specFile3"
```

**Examples:**
```bash
# HubSpot connector
--resources "CompaniesResource:hubspot-companies.json,ContactsResource:hubspot-contacts.json,ListsResource:hubspot-lists.json"

# Salesforce connector  
--resources "AccountsResource:sf-accounts.json,ContactsResource:sf-contacts.json,OpportunitiesResource:sf-opportunities.json"

# Stripe connector
--resources "CustomersResource:stripe-customers.json,PaymentsResource:stripe-payments.json,SubscriptionsResource:stripe-subscriptions.json"
```

## Adding Resources to Existing Projects

### 1. Add New Resource

```bash
npx @aloma.io/integration-sdk@latest add-resource ./existing-project \
  --className "DealsResource" \
  --spec "deals.json"
```

This will:
- Generate the new resource class
- Save it to `src/resources/deals.mts`
- Provide instructions for updating the main controller

### 2. Update Main Controller Manually

After adding a resource, you need to update the main controller:

```typescript
// 1. Add import
import DealsResource from '../resources/deals.mjs';

// 2. Add property
deals!: DealsResource;

// 3. Add initialization in start()
this.deals = new DealsResource(this);
```

## Usage Examples

### Generated API Calls

```typescript
// Companies resource
await controller.companies.create({
  body: { properties: { name: 'Acme Corp', domain: 'acme.com' } }
});

await controller.companies.getPage({
  limit: 10,
  properties: ['name', 'domain', 'industry']
});

await controller.companies.getById('12345', {
  properties: ['name', 'email']
});

// Contacts resource
await controller.contacts.create({
  body: { properties: { firstname: 'John', lastname: 'Doe', email: 'john@example.com' } }
});

await controller.contacts.getPage({
  limit: 20,
  properties: ['firstname', 'lastname', 'email']
});

// Lists resource
await controller.lists.getAll({ limit: 50 });

await controller.lists.create({
  body: { name: 'My Contact List', processingType: 'MANUAL' }
});
```

### With Custom Headers

```typescript
await controller.companies.getPage({
  limit: 10,
  headers: {
    'X-Request-ID': 'unique-id-123',
    'X-Custom-Header': 'value'
  }
});
```

## Best Practices

### 1. Resource Naming
- Use descriptive class names: `CompaniesResource`, `ContactsResource`
- File names are auto-generated: `companies.mts`, `contacts.mts`
- Property names in controller: `companies`, `contacts`

### 2. OpenAPI Specifications
- Each resource should have its own focused OpenAPI spec
- Ensure all specs use the same base URL or provide `--base-url`
- Use consistent parameter naming across specs

### 3. Error Handling
- All generated methods return promises
- API errors are handled by the underlying `api.fetch()` method
- Add custom error handling in your connector logic as needed

### 4. Type Safety
- Generated code uses `any` types for flexibility
- Consider adding TypeScript interfaces for better type safety
- Use JSDoc comments for parameter documentation

## Example: Complete HubSpot Connector

```bash
# Create the connector
npx @aloma.io/integration-sdk@latest create-multi-resource "HubSpot-v2" \
  --connector-id "hubspot-123" \
  --resources "CompaniesResource:examples/hubspot-companies.json,ContactsResource:examples/hubspot-contacts.json,ListsResource:examples/hubspot-lists.json" \
  --base-url "https://api.hubapi.com"

# Install dependencies
cd HubSpot-v2
yarn --ignore-engines

# Build
yarn build

# Start
yarn start
```

## Troubleshooting

### Import Path Errors
If you see TypeScript errors about missing file extensions:
- Ensure you're using `.mjs` extensions in imports
- The generator handles this automatically in new projects

### Resource Not Found
If a resource property is undefined:
- Check that the resource is properly initialized in `start()`
- Verify the import path in the main controller
- Ensure the resource file was generated correctly

### Build Errors
If the project fails to build:
- Try using `--no-build` flag during creation
- Install dependencies manually: `yarn --ignore-engines`
- Check for TypeScript errors in generated files

## Migration from Single-Resource

To convert an existing single-resource connector to multi-resource:

1. Extract the relevant endpoints into separate OpenAPI specs
2. Create new resource classes using `from-openapi --resource`
3. Update the main controller to compose the resources
4. Remove the old single controller methods

This approach maintains backward compatibility while providing better organization for large APIs.
