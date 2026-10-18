import {AbstractController, callOperation} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';

const OPERATIONS: {[name: string]: OperationDescriptor} = {
  "getProducts": {"method":"GET","path":"/products","pathParams":[],"query":[],"headers":[],"body":null},
  "createProduct": {"method":"POST","path":"/products","pathParams":[],"query":[],"headers":[],"body":{"mode":"wrapper","contentType":"application/json"}},
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
   * Get all products
   *
   * GET /products
   *
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.simpleTest.getProducts({})
   * ```
   *
   * @returns {Promise<any>} GET /products response
   */
  async getProducts({headers}: {headers?: Record<string, string>} = {}) {
    return callOperation(this.api, OPERATIONS.getProducts, {headers});
  }

  /**
   * Create product
   *
   * POST /products
   *
   * @param {any} body (required) - request body (application/json)
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.simpleTest.createProduct({ body: {} })
   * ```
   *
   * @returns {Promise<any>} POST /products response
   */
  async createProduct({body, headers}: {body: any; headers?: Record<string, string>}) {
    return callOperation(this.api, OPERATIONS.createProduct, {body, headers});
  }
}
