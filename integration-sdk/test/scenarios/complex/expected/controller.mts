import {AbstractController} from '@aloma.io/integration-sdk';
import * as productsFunctions from '../resources/products.mjs';
import type * as productsTypes from '../resources/products.mjs';
import * as ordersFunctions from '../resources/orders.mjs';
import type * as ordersTypes from '../resources/orders.mjs';

export default class Controller extends AbstractController {
  products: any = {};
  orders: any = {};

  private api: any;

  protected async start(): Promise<void> {
    const config = this.config;

    this.api = this.getClient({
      baseUrl: "https://api.testshop.com",
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
  async request({url, options}: {url: string; options?: any}) {
    return this.api.fetch(url, options);
  }

  /**
   * List all products
   *
   * GET /products
   *
   * @param {number} limit (optional) - Maximum number of products to return [query]
   * @param {string} category (optional) - Filter by category [query]
   * @param {boolean} archived (optional) - Include archived products [query]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.products.productsGetProducts({})
   * ```
   *
   * @returns {Promise<productsTypes.ProductList>} GET /products response
   */
  async productsGetProducts({limit, category, archived, headers}: {limit?: number; category?: string; archived?: boolean; headers?: Record<string, string>} = {}) {
    return this.products.getProducts({limit, category, archived, headers});
  }

  /**
   * Create a new product
   *
   * POST /products
   *
   * @param {string} name (required) - Product name [body]
   * @param {string} description (optional) - Product description [body]
   * @param {number} price (required) - Product price [body]
   * @param {string} category (optional) - Product category [body]
   * @param {string[]} tags (optional) - Product tags [body]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.products.productsCreateProduct({ name: "name-value", price: 1 })
   * ```
   *
   * @returns {Promise<productsTypes.Product>} POST /products response
   */
  async productsCreateProduct({name, description, price, category, tags, headers}: {name: string; description?: string; price: number; category?: string; tags?: string[]; headers?: Record<string, string>}) {
    return this.products.createProduct({name, description, price, category, tags, headers});
  }

  /**
   * Get a specific product
   *
   * GET /products/{productId}
   *
   * @param {string} productId (required) - The product ID [path]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.products.productsGetProduct({ productId: "productId-1" })
   * ```
   *
   * @returns {Promise<productsTypes.Product>} GET /products/{productId} response
   */
  async productsGetProduct({productId, headers}: {productId: string; headers?: Record<string, string>}) {
    return this.products.getProduct({productId, headers});
  }

  /**
   * Update a product
   *
   * PUT /products/{productId}
   *
   * @param {string} productId (required) - The product ID [path]
   * @param {string} name (optional) - Product name [body]
   * @param {string} description (optional) - Product description [body]
   * @param {number} price (optional) - Product price [body]
   * @param {string} category (optional) - Product category [body]
   * @param {boolean} inStock (optional) - Whether product is in stock [body]
   * @param {string[]} tags (optional) - Product tags [body]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.products.productsUpdateProduct({ productId: "productId-1" })
   * ```
   *
   * @returns {Promise<productsTypes.Product>} PUT /products/{productId} response
   */
  async productsUpdateProduct({productId, name, description, price, category, inStock, tags, headers}: {productId: string; name?: string; description?: string; price?: number; category?: string; inStock?: boolean; tags?: string[]; headers?: Record<string, string>}) {
    return this.products.updateProduct({productId, name, description, price, category, inStock, tags, headers});
  }

  /**
   * Delete a product
   *
   * DELETE /products/{productId}
   *
   * @param {string} productId (required) - The product ID [path]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.products.productsDeleteProduct({ productId: "productId-1" })
   * ```
   *
   * @returns {Promise<any>} DELETE /products/{productId} response
   */
  async productsDeleteProduct({productId, headers}: {productId: string; headers?: Record<string, string>}) {
    return this.products.deleteProduct({productId, headers});
  }

  /**
   * List all orders
   *
   * GET /orders
   *
   * @param {string} status (optional) - Filter by order status [query]
   * @param {string} customerId (optional) - Filter by customer ID [query]
   * @param {number} limit (optional) - Maximum number of orders to return [query]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.orders.ordersGetOrders({})
   * ```
   *
   * @returns {Promise<ordersTypes.OrderList>} GET /orders response
   */
  async ordersGetOrders({status, customerId, limit, headers}: {status?: string; customerId?: string; limit?: number; headers?: Record<string, string>} = {}) {
    return this.orders.getOrders({status, customerId, limit, headers});
  }

  /**
   * Create a new order
   *
   * POST /orders
   *
   * @param {string} customerId (required) - Customer who is placing the order [body]
   * @param {ordersTypes.OrderItemRequest[]} items (required) - Items to order [body]
   * @param {ordersTypes.Address} shippingAddress (optional) -  [body]
   * @param {ordersTypes.Address} billingAddress (optional) -  [body]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.orders.ordersCreateOrder({ customerId: "customerId-value", items: [{"productId":"productId-value"}] })
   * ```
   *
   * @returns {Promise<ordersTypes.Order>} POST /orders response
   */
  async ordersCreateOrder({customerId, items, shippingAddress, billingAddress, headers}: {customerId: string; items: ordersTypes.OrderItemRequest[]; shippingAddress?: ordersTypes.Address; billingAddress?: ordersTypes.Address; headers?: Record<string, string>}) {
    return this.orders.createOrder({customerId, items, shippingAddress, billingAddress, headers});
  }

  /**
   * Get a specific order
   *
   * GET /orders/{orderId}
   *
   * @param {string} orderId (required) - The order ID [path]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.orders.ordersGetOrder({ orderId: "orderId-1" })
   * ```
   *
   * @returns {Promise<ordersTypes.Order>} GET /orders/{orderId} response
   */
  async ordersGetOrder({orderId, headers}: {orderId: string; headers?: Record<string, string>}) {
    return this.orders.getOrder({orderId, headers});
  }

  /**
   * Update order status
   *
   * PATCH /orders/{orderId}
   *
   * @param {string} orderId (required) - The order ID [path]
   * @param {string} status (required) - New order status [body]
   * @param {string} trackingNumber (optional) - Tracking number (for shipped status) [body]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.orders.ordersUpdateOrderStatus({ orderId: "orderId-1", status: "confirmed" })
   * ```
   *
   * @returns {Promise<ordersTypes.Order>} PATCH /orders/{orderId} response
   */
  async ordersUpdateOrderStatus({orderId, status, trackingNumber, headers}: {orderId: string; status: string; trackingNumber?: string; headers?: Record<string, string>}) {
    return this.orders.updateOrderStatus({orderId, status, trackingNumber, headers});
  }

  /**
   * Cancel an order
   *
   * POST /orders/{orderId}/cancel
   *
   * @param {string} orderId (required) - The order ID [path]
   * @param {Record<string, string>} headers (optional) - extra request headers
   *
   * @example usage
   * ```
   * await connectors.orders.ordersCancelOrder({ orderId: "orderId-1" })
   * ```
   *
   * @returns {Promise<ordersTypes.Order>} POST /orders/{orderId}/cancel response
   */
  async ordersCancelOrder({orderId, headers}: {orderId: string; headers?: Record<string, string>}) {
    return this.orders.cancelOrder({orderId, headers});
  }
}
