// OrdersResource resource functions
// These functions will be bound to the controller instance and accessible as orders.method()

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
export function getOrders(this: any, options?: {status?: string, customerId?: string, limit?: number}) {
  options = options || {};

  const url = '/orders';

  const fetchOptions: any = {
    method: 'GET',
    params: {},
    headers: options.headers,
  };

  // Add query parameters
  if (options.status !== undefined) {
    fetchOptions.params.status = options.status;
  }
  if (options.customerId !== undefined) {
    fetchOptions.params.customerId = options.customerId;
  }
  if (options.limit !== undefined) {
    fetchOptions.params.limit = options.limit;
  }

    return this.api.fetch(url, fetchOptions);
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
export function createOrder(this: any, options: {customerId: string /** Customer who is placing the order */, items: OrderItemRequest[] /** Items to order */, shippingAddress: Address, billingAddress: Address}) {
  options = options || {};

  const url = '/orders';

  const { headers, ...bodyData } = options;
  const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;

  const fetchOptions: any = {
    method: 'POST',
    body: requestBody,
    headers: options.headers,
  };

    return this.api.fetch(url, fetchOptions);
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
export function getOrder(this: any, orderId: string) {
  let url = '/orders/{orderId}';
  if (orderId) {
    url = url.replace('{orderId}', orderId);
  }

  return this.api.fetch(url, {
    method: 'GET',
  });
    return this.api.fetch(url, fetchOptions);
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
export function updateOrderStatus(this: any, orderId: string, options: {status: string /** New order status */, trackingNumber: string /** Tracking number (for shipped status */})) {
  options = options || {};

  // Build URL with path parameters
  let url = '/orders/{orderId}';
  if (orderId) {
    url = url.replace('{orderId}', orderId);
  }

  const { headers, ...bodyData } = options;
  const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;

  const fetchOptions: any = {
    method: 'PATCH',
    body: requestBody,
    headers: options.headers,
  };

    return this.api.fetch(url, fetchOptions);
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
export function cancelOrder(this: any, orderId: string) {
  let url = '/orders/{orderId}/cancel';
  if (orderId) {
    url = url.replace('{orderId}', orderId);
  }

  return this.api.fetch(url, {
    method: 'POST',
  });
    return this.api.fetch(url, fetchOptions);
}