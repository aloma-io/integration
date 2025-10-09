# nodejs - Aloma Integration SDK

## Creating a new Connector

With the aloma integration SDK cli you can create a new connector in three ways:

### 1. Create from scratch
```bash
npx @aloma.io/integration-sdk@latest create connectorName --connector-id 1234
```

### 2. Generate from OpenAPI specification
```bash
npx @aloma.io/integration-sdk@latest from-openapi connectorName --connector-id 1234 --spec api.yaml
```

This will automatically generate a complete connector project with methods for all OpenAPI endpoints, ready for implementation.

### 3. Generate with Resource Architecture (Recommended for large APIs)
```bash
npx @aloma.io/integration-sdk@latest from-openapi connectorName \
  --connector-id 1234 \
  --spec api.yaml \
  --out src/resources/myresource.mts \
  --resource MyResource \
  --no-build
```

### 4. Create Multi-Resource Connector (Recommended for complex APIs)
```bash
npx @aloma.io/integration-sdk@latest create-multi-resource "HubSpot-v2" \
  --connector-id "hubspot-123" \
  --resources "CompaniesResource:examples/hubspot-companies.json,ContactsResource:examples/hubspot-contacts.json,ListsResource:examples/hubspot-lists.json" \
  --base-url "https://api.hubapi.com"
```

This creates a complete multi-resource connector with:
- Individual resource classes for each OpenAPI spec
- Main controller that composes all resources
- Proper TypeScript imports and architecture

```typescript
// Usage
await controller.companies.create({ body: { properties: { name: 'Acme' } } });
await controller.contacts.getPage({ limit: 10 });
await controller.lists.getAll({ limit: 50 });
```

### 5. Add Resource to Existing Project
```bash
npx @aloma.io/integration-sdk@latest add-resource ./existing-project \
  --className "DealsResource" \
  --spec "deals.json"
```

This adds a new resource to an existing multi-resource connector.

## 📚 Documentation

- **[OPENAPI_TO_CONNECTOR.md](./OPENAPI_TO_CONNECTOR.md)** - OpenAPI generator details
- **[MULTI_RESOURCE_GUIDE.md](./MULTI_RESOURCE_GUIDE.md)** - Complete guide for multi-resource connectors

## 🚀 Quick Examples

### HubSpot Multi-Resource Connector
```bash
# Create complete HubSpot connector with 3 resources
npx @aloma.io/integration-sdk@latest create-multi-resource "HubSpot-v2" \
  --connector-id "hubspot-123" \
  --resources "CompaniesResource:examples/hubspot-companies.json,ContactsResource:examples/hubspot-contacts.json,ListsResource:examples/hubspot-lists.json"

```
