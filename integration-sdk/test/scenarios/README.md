# Scenario Tests

This directory contains full scenario tests that verify the complete code generation pipeline from OpenAPI specifications to generated connector code.

## Purpose

These tests ensure that:
1. Generated code exactly matches expected fixtures
2. All features work correctly end-to-end
3. Regressions are caught immediately
4. Code generation is deterministic and consistent

## Structure

```
test/scenarios/
├── README.md                          # This file
├── simple/                            # Simple single-controller scenario
│   ├── simple-api.json               # Input OpenAPI spec (copied from examples/)
│   └── expected-controller.mts       # Expected generated controller output
└── complex/                          # Complex multi-resource scenario
    ├── specs/                        # Input OpenAPI specs
    │   ├── products.json            # Products API specification
    │   └── orders.json              # Orders API specification
    └── expected/                     # Expected generated outputs
        ├── controller.mts           # Expected main controller
        ├── products-resource.mts    # Expected products resource functions
        └── orders-resource.mts      # Expected orders resource functions
```

## Scenarios

### Simple Scenario

**Input**: `simple/simple-api.json`
- Basic Products API with 2 endpoints
- Tests single-controller generation (`from-openapi` command)
- Verifies methods without options don't have unnecessary code

**Expected Output**: `simple/expected-controller.mts`
- Clean controller with proper TypeScript types
- Methods without options parameters are minimal
- Methods with options have proper signatures

### Complex Scenario

**Inputs**: 
- `complex/specs/products.json` - Products management API (5 endpoints)
- `complex/specs/orders.json` - Orders management API (5 endpoints)

**Tests multi-resource generation** (`create-multi-resource` command):
- Resource function generation
- Main controller with exposed methods
- Resource binding and composition
- Complex TypeScript interface generation
- Path parameter handling

**Expected Outputs**:
- `complex/expected/controller.mts` - Main controller with resource bindings
- `complex/expected/products-resource.mts` - Products resource functions
- `complex/expected/orders-resource.mts` - Orders resource functions

## Test Coverage

The scenario tests verify:

### Core Functionality
- ✅ Single controller generation (`from-openapi`)
- ✅ Multi-resource generation (`create-multi-resource`)
- ✅ TypeScript interface generation from schemas
- ✅ Method signature generation (path params + options)
- ✅ JSDoc comment generation

### Quality Features
- ✅ Schema name sanitization (dots → underscores)
- ✅ Clean code generation (no unnecessary options)
- ✅ Resource method exposure in main controller
- ✅ Path parameter vs options separation
- ✅ Request body inline construction

### Regression Protection
- ✅ Invalid TypeScript interface names
- ✅ Unnecessary options parameter in simple methods
- ✅ Missing headers property access
- ✅ Circular schema reference handling

## Running Tests

```bash
# Run scenario tests only
npm run test:scenarios

# Run all tests
npm run test:all

# Direct execution
node test/verify-scenarios.mjs
```

## Updating Fixtures

When code generation logic changes, you may need to update the expected fixtures:

### Simple Scenario
```bash
# Regenerate expected output
node build/cli.mjs from-openapi simple-test \
  --connector-id "simple-test" \
  --spec "test/scenarios/simple/simple-api.json" \
  --controller-only \
  --out "test/scenarios/simple/expected-controller.mts"
```

### Complex Scenario
```bash
# Regenerate multi-resource outputs
node build/cli.mjs create-multi-resource \
  --connector-id "test-shop" \
  --resources "ProductsResource:test/scenarios/complex/specs/products.json,OrdersResource:test/scenarios/complex/specs/orders.json" \
  --base-url "https://api.testshop.com" \
  --no-build test-shop-temp

# Copy to expected fixtures
cp test-shop-temp/src/controller/index.mts test/scenarios/complex/expected/controller.mts
cp test-shop-temp/src/resources/products.mts test/scenarios/complex/expected/products-resource.mts
cp test-shop-temp/src/resources/orders.mts test/scenarios/complex/expected/orders-resource.mts

# Cleanup
rm -rf test-shop-temp
```

## Benefits

1. **Confidence**: Any change to code generation is immediately tested against real scenarios
2. **Documentation**: Fixtures serve as examples of expected output
3. **Regression Prevention**: Prevents accidental breaking changes
4. **Quality Assurance**: Ensures generated code meets quality standards
5. **Debugging**: Easy to compare actual vs expected output when tests fail

## API Examples

The test scenarios use realistic API examples:

- **Simple API**: Basic product CRUD operations
- **Products API**: Product management with categories, pricing, inventory
- **Orders API**: Order lifecycle management with status updates, addresses

These examples demonstrate real-world usage patterns and edge cases that the code generator must handle correctly.