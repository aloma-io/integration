# nodejs - Aloma Integration SDK

## Creating a new Connector

With the aloma integration SDK cli you can create a new connector in two ways:

### 1. Create from scratch
```bash
npx @aloma.io/integration-sdk@latest create connectorName --connector-id 1234
```

### 2. Generate from OpenAPI specification
```bash
npx @aloma.io/integration-sdk@latest from-openapi connectorName --connector-id 1234 --spec api.yaml
```

This will automatically generate a complete connector project with methods for all OpenAPI endpoints, ready for implementation.

For more details, see [OPENAPI_TO_CONNECTOR.md](./OPENAPI_TO_CONNECTOR.md).
