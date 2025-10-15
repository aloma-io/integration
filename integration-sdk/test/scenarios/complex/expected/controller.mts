import {AbstractController} from '@aloma.io/integration-sdk';
import * as productsFunctions from '../resources/products.mjs';
import * as ordersFunctions from '../resources/orders.mjs';

export default class Controller extends AbstractController {
  products: any = {};
  orders: any = {};

  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;
    
    this.api = this.getClient({
      baseUrl: 'https://api.testshop.com',
      customize(request) {
        request.headers ||= {};
        // Add authentication headers based on your API requirements
        // Example: request.headers["Authorization"] = `Bearer ${config.apiToken}`;
      },
    });
    
    // Bind resource functions to this controller context
    // This allows using this.resourceName.method() syntax
    this.bindResourceFunctions('products', productsFunctions);
    this.bindResourceFunctions('orders', ordersFunctions);
  }

  private bindResourceFunctions(resourceName: string, functions: any) {
    for (const [functionName, func] of Object.entries(functions)) {
      if (typeof func === 'function') {
        this[resourceName][functionName] = func.bind(this);
      }
    }
  }

  /**
   * Generic API request method
   * @param url - API endpoint
   * @param options - Request options
   */
  async request({ url, options }: { url: string; options?: any }) {
    return this.api.fetch(url, options);
  }

  /**
 * List all products
 *
 * @param {Object} options - Request options
 * @param {number} options.limit (optional) - Maximum number of products to return [query]
 * @param {string} options.category (optional) - Filter by category [query]
 * @param {boolean} options.archived (optional) - Include archived products [query]
 *
 * @returns {Promise<ProductList>} GET /products response
 *
 * response fields:
 * - products?: Product[]
 * - total?: number - Total number of products
 * - hasMore?: boolean - Whether there are more products available
   */
  async productsGetProducts(options?: {limit?: number, category?: string, archived?: boolean}) {
    return this.products.getProducts(options);
  }

  /**
 * Create a new product
 *
 * @param {Object} options - Request options
 * @param {string} options.name (required) - Product name [body property]
 * @param {string} options.description (required) - Product description [body property]
 * @param {number} options.price (required) - Product price [body property]
 * @param {string} options.category (required) - Product category [body property]
 * @param {string[]} options.tags (required) - Product tags [body property]
 *
 * @returns {Promise<Product>} POST /products response
 *
 * response fields:
 * - id: string - Unique product identifier
 * - name: string - Product name
 * - description?: string - Product description
 * - price: number - Product price
 * - category?: string - Product category
 * - inStock?: boolean - Whether product is in stock
 * - tags?: string[] - Product tags
 * - createdAt?: string - Creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async productsCreateProduct(options: {name: string /** Product name */, description: string /** Product description */, price: number /** Product price */, category: string /** Product category */, tags: string[] /** Product tags */}) {
    return this.products.createProduct(options);
  }

  /**
 * Get a specific product
 *
 * @param {string} productId The product ID
 * @param {Object} options (optional) - Request options
 *
 * @returns {Promise<Product>} GET /products/{productId} response
 *
 * response fields:
 * - id: string - Unique product identifier
 * - name: string - Product name
 * - description?: string - Product description
 * - price: number - Product price
 * - category?: string - Product category
 * - inStock?: boolean - Whether product is in stock
 * - tags?: string[] - Product tags
 * - createdAt?: string - Creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async productsGetProduct(productId: string) {
    return this.products.getProduct(productId);
  }

  /**
 * Update a product
 *
 * @param {string} productId The product ID
 * @param {Object} options - Request options
 * @param {string} options.name (required) - Product name [body property]
 * @param {string} options.description (required) - Product description [body property]
 * @param {number} options.price (required) - Product price [body property]
 * @param {string} options.category (required) - Product category [body property]
 * @param {boolean} options.inStock (required) - Whether product is in stock [body property]
 * @param {string[]} options.tags (required) - Product tags [body property]
 *
 * @returns {Promise<Product>} PUT /products/{productId} response
 *
 * response fields:
 * - id: string - Unique product identifier
 * - name: string - Product name
 * - description?: string - Product description
 * - price: number - Product price
 * - category?: string - Product category
 * - inStock?: boolean - Whether product is in stock
 * - tags?: string[] - Product tags
 * - createdAt?: string - Creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async productsUpdateProduct(productId: string, options: {name: string /** Product name */, description: string /** Product description */, price: number /** Product price */, category: string /** Product category */, inStock: boolean /** Whether product is in stock */, tags: string[] /** Product tags */}) {
    return this.products.updateProduct(productId, options);
  }

  /**
 * Delete a product
 *
 * @param {string} productId The product ID
 * @param {Object} options (optional) - Request options
 *
 * @returns {Promise<any>} DELETE /products/{productId} response
   */
  async productsDeleteProduct(productId: string) {
    return this.products.deleteProduct(productId);
  }

  /**
 * List all orders
 *
 * @param {Object} options - Request options
 * @param {string} options.status (optional) - Filter by order status [query]
 * @param {string} options.customerId (optional) - Filter by customer ID [query]
 * @param {number} options.limit (optional) - Maximum number of orders to return [query]
 *
 * @returns {Promise<OrderList>} GET /orders response
 *
 * response fields:
 * - orders?: Order[]
 * - total?: number - Total number of orders
 * - hasMore?: boolean - Whether there are more orders available
   */
  async ordersGetOrders(options?: {status?: string, customerId?: string, limit?: number}) {
    return this.orders.getOrders(options);
  }

  /**
 * Create a new order
 *
 * @param {Object} options - Request options
 * @param {string} options.customerId (required) - Customer who is placing the order [body property]
 * @param {OrderItemRequest[]} options.items (required) - Items to order [body property]
 * @param {Address} options.shippingAddress (required) -  [body property]
 * @param {Address} options.billingAddress (required) -  [body property]
 *
 * @returns {Promise<Order>} POST /orders response
 *
 * response fields:
 * - id: string - Unique order identifier
 * - customerId: string - Customer who placed the order
 * - items: OrderItem[] - Items in the order
 * - status: string - Current order status
 * - totalAmount: number - Total order amount
 * - shippingAddress?: Address
 * - billingAddress?: Address
 * - createdAt?: string - Order creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async ordersCreateOrder(options: {customerId: string /** Customer who is placing the order */, items: OrderItemRequest[] /** Items to order */, shippingAddress: Address, billingAddress: Address}) {
    return this.orders.createOrder(options);
  }

  /**
 * Get a specific order
 *
 * @param {string} orderId The order ID
 * @param {Object} options (optional) - Request options
 *
 * @returns {Promise<Order>} GET /orders/{orderId} response
 *
 * response fields:
 * - id: string - Unique order identifier
 * - customerId: string - Customer who placed the order
 * - items: OrderItem[] - Items in the order
 * - status: string - Current order status
 * - totalAmount: number - Total order amount
 * - shippingAddress?: Address
 * - billingAddress?: Address
 * - createdAt?: string - Order creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async ordersGetOrder(orderId: string) {
    return this.orders.getOrder(orderId);
  }

  /**
 * Update order status
 *
 * @param {string} orderId The order ID
 * @param {Object} options - Request options
 * @param {string} options.status (required) - New order status [body property]
 * @param {string} options.trackingNumber (required) - Tracking number (for shipped status) [body property]
 *
 * @returns {Promise<Order>} PATCH /orders/{orderId} response
 *
 * response fields:
 * - id: string - Unique order identifier
 * - customerId: string - Customer who placed the order
 * - items: OrderItem[] - Items in the order
 * - status: string - Current order status
 * - totalAmount: number - Total order amount
 * - shippingAddress?: Address
 * - billingAddress?: Address
 * - createdAt?: string - Order creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async ordersUpdateOrderStatus(orderId: string, options: {status: string /** New order status */, trackingNumber: string /** Tracking number (for shipped status) */}) {
    return this.orders.updateOrderStatus(orderId, options);
  }

  /**
 * Cancel an order
 *
 * @param {string} orderId The order ID
 * @param {Object} options (optional) - Request options
 *
 * @returns {Promise<Order>} POST /orders/{orderId}/cancel response
 *
 * response fields:
 * - id: string - Unique order identifier
 * - customerId: string - Customer who placed the order
 * - items: OrderItem[] - Items in the order
 * - status: string - Current order status
 * - totalAmount: number - Total order amount
 * - shippingAddress?: Address
 * - billingAddress?: Address
 * - createdAt?: string - Order creation timestamp
 * - updatedAt?: string - Last update timestamp
   */
  async ordersCancelOrder(orderId: string) {
    return this.orders.cancelOrder(orderId);
  }
}