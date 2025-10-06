#!/bin/bash

# Example script to generate a connector from OpenAPI specification
# Usage: ./generate-connector.sh <connector-name> <openapi-file> [output-file]

set -e

CONNECTOR_NAME=${1:-"My API Connector"}
OPENAPI_FILE=${2:-"./sample-api.yaml"}
OUTPUT_FILE=${3:-"./generated-controller.mts"}

echo "🚀 Generating connector: $CONNECTOR_NAME"
echo "📄 OpenAPI spec: $OPENAPI_FILE"
echo "📝 Output file: $OUTPUT_FILE"
echo ""

# Check if OpenAPI file exists
if [ ! -f "$OPENAPI_FILE" ]; then
    echo "❌ Error: OpenAPI file '$OPENAPI_FILE' not found"
    exit 1
fi

# Generate the connector
node ../build/openapi-to-connector.mjs generate \
    --name "$CONNECTOR_NAME" \
    --spec "$OPENAPI_FILE" \
    --out "$OUTPUT_FILE"

echo ""
echo "✅ Success! Generated connector controller: $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "1. Review the generated controller"
echo "2. Implement the actual API calls in each method"
echo "3. Add the controller to your Aloma connector project"
