import {AbstractController} from '@aloma.io/integration-sdk';

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
 * Get all products
 *
 *
 * @returns {Promise<any>} GET /products response
   */
  async getProducts() {
    const url = '/products';

    const fetchOptions: any = {
      method: 'GET',
    };

    return this.api.fetch(url, fetchOptions);
  }

  /**
 * Create product
 *
 * @param {Object} options - Request options
 * @param {any} options.body (required) - Request body
 *
 * @returns {Promise<any>} POST /products response
   */
  async createProduct(options: {body?: any}) {
    options = options || {};

    const url = '/products';

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