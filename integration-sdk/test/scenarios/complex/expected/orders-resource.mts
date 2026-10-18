// OrdersResource resource functions
// These functions will be bound to the controller instance and accessible as orders.method()
import {callOperation} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';

// Generated TypeScript interfaces from OpenAPI schemas

export interface Order {
  /** Unique order identifier */
  id: string;
  /** Customer who placed the order */
  customerId: string;
  /** Items in the order */
  items: OrderItem[];
  /** Current order status */
  status: string;
  /** Total order amount */
  totalAmount: number;
  shippingAddress?: Address;
  billingAddress?: Address;
  /** Order creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
}

export interface OrderItem {
  /** Product identifier */
  productId: string;
  /** Product name */
  productName?: string;
  /** Quantity ordered */
  quantity: number;
  /** Price per unit */
  unitPrice: number;
  /** Total price for this item */
  totalPrice?: number;
}

export interface Address {
  /** Street address */
  street: string;
  /** City */
  city: string;
  /** State or province */
  state?: string;
  /** ZIP or postal code */
  zipCode: string;
  /** Country */
  country: string;
}

export interface OrderList {
  orders?: Order[];
  /** Total number of orders */
  total?: number;
  /** Whether there are more orders available */
  hasMore?: boolean;
}

export interface CreateOrderRequest {
  /** Customer who is placing the order */
  customerId: string;
  /** Items to order */
  items: OrderItemRequest[];
  shippingAddress?: Address;
  billingAddress?: Address;
}

export interface OrderItemRequest {
  /** Product to order */
  productId: string;
  /** Quantity to order */
  quantity: number;
}

export interface UpdateOrderStatusRequest {
  /** New order status */
  status: string;
  /** Tracking number (for shipped status) */
  trackingNumber?: string;
}

const OPERATIONS: {[name: string]: OperationDescriptor} = {
  "getOrders": {"method":"GET","path":"/orders","pathParams":[],"query":[{"name":"status"},{"name":"customerId"},{"name":"limit"}],"headers":[],"body":null},
  "createOrder": {"method":"POST","path":"/orders","pathParams":[],"query":[],"headers":[],"body":{"mode":"flat","contentType":"application/json","fields":["customerId","items","shippingAddress","billingAddress"]}},
  "getOrder": {"method":"GET","path":"/orders/{orderId}","pathParams":["orderId"],"query":[],"headers":[],"body":null},
  "updateOrderStatus": {"method":"PATCH","path":"/orders/{orderId}","pathParams":["orderId"],"query":[],"headers":[],"body":{"mode":"flat","contentType":"application/json","fields":["status","trackingNumber"]}},
  "cancelOrder": {"method":"POST","path":"/orders/{orderId}/cancel","pathParams":["orderId"],"query":[],"headers":[],"body":null},
};

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
 * await connectors.testShop.ordersGetOrders({})
 * ```
 *
 * @returns {Promise<OrderList>} GET /orders response
 *
 * response fields:
 * - orders?: Order[]
 * - total?: number - Total number of orders
 * - hasMore?: boolean - Whether there are more orders available
 */
export function getOrders(this: any, {status, customerId, limit, headers}: {status?: string; customerId?: string; limit?: number; headers?: Record<string, string>} = {}) {
  return callOperation(this.api, OPERATIONS.getOrders, {status, customerId, limit, headers});
}

/**
 * Create a new order
 *
 * POST /orders
 *
 * @param {string} customerId (required) - Customer who is placing the order [body]
 * @param {OrderItemRequest[]} items (required) - Items to order [body]
 * @param {Address} shippingAddress (optional) -  [body]
 * @param {Address} billingAddress (optional) -  [body]
 * @param {Record<string, string>} headers (optional) - extra request headers
 *
 * @example usage
 * ```
 * await connectors.testShop.ordersCreateOrder({ customerId: "customerId-value", items: [{"productId":"productId-value"}] })
 * ```
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
export function createOrder(this: any, {customerId, items, shippingAddress, billingAddress, headers}: {customerId: string; items: OrderItemRequest[]; shippingAddress?: Address; billingAddress?: Address; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.createOrder, {customerId, items, shippingAddress, billingAddress, headers});
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
 * await connectors.testShop.ordersGetOrder({ orderId: "orderId-1" })
 * ```
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
export function getOrder(this: any, {orderId, headers}: {orderId: string; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.getOrder, {orderId, headers});
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
 * await connectors.testShop.ordersUpdateOrderStatus({ orderId: "orderId-1", status: "confirmed" })
 * ```
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
export function updateOrderStatus(this: any, {orderId, status, trackingNumber, headers}: {orderId: string; status: string; trackingNumber?: string; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.updateOrderStatus, {orderId, status, trackingNumber, headers});
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
 * await connectors.testShop.ordersCancelOrder({ orderId: "orderId-1" })
 * ```
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
export function cancelOrder(this: any, {orderId, headers}: {orderId: string; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.cancelOrder, {orderId, headers});
}
