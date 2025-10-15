// ProductsResource resource functions
// These functions will be bound to the controller instance and accessible as products.method()

// Generated TypeScript interfaces from OpenAPI schemas

export interface Product {
  /** Unique product identifier */
  id: string;
  /** Product name */
  name: string;
  /** Product description */
  description?: string;
  /** Product price */
  price: number;
  /** Product category */
  category?: string;
  /** Whether product is in stock */
  inStock?: boolean;
  /** Product tags */
  tags?: string[];
  /** Creation timestamp */
  createdAt?: string;
  /** Last update timestamp */
  updatedAt?: string;
}

export interface ProductList {
  products?: Product[];
  /** Total number of products */
  total?: number;
  /** Whether there are more products available */
  hasMore?: boolean;
}

export interface CreateProductRequest {
  /** Product name */
  name: string;
  /** Product description */
  description?: string;
  /** Product price */
  price: number;
  /** Product category */
  category?: string;
  /** Product tags */
  tags?: string[];
}

export interface UpdateProductRequest {
  /** Product name */
  name?: string;
  /** Product description */
  description?: string;
  /** Product price */
  price?: number;
  /** Product category */
  category?: string;
  /** Whether product is in stock */
  inStock?: boolean;
  /** Product tags */
  tags?: string[];
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
export function getProducts(this: any, options?: {limit?: number, category?: string, archived?: boolean}) {
  options = options || {};

  const url = '/products';

  const fetchOptions: any = {
    method: 'GET',
    params: {},
    headers: options.headers,
  };

  // Add query parameters
  if (options.limit !== undefined) {
    fetchOptions.params.limit = options.limit;
  }
  if (options.category !== undefined) {
    fetchOptions.params.category = options.category;
  }
  if (options.archived !== undefined) {
    fetchOptions.params.archived = options.archived;
  }

    return this.api.fetch(url, fetchOptions);
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
export function createProduct(this: any, options: {name: string /** Product name */, description: string /** Product description */, price: number /** Product price */, category: string /** Product category */, tags: string[] /** Product tags */}) {
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
export function getProduct(this: any, productId: string) {
  let url = '/products/{productId}';
  if (productId) {
    url = url.replace('{productId}', productId);
  }

  return this.api.fetch(url, {
    method: 'GET',
  });
    return this.api.fetch(url, fetchOptions);
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
export function updateProduct(this: any, productId: string, options: {name: string /** Product name */, description: string /** Product description */, price: number /** Product price */, category: string /** Product category */, inStock: boolean /** Whether product is in stock */, tags: string[] /** Product tags */}) {
  options = options || {};

  // Build URL with path parameters
  let url = '/products/{productId}';
  if (productId) {
    url = url.replace('{productId}', productId);
  }

  const { headers, ...bodyData } = options;
  const requestBody = Object.keys(bodyData).length > 0 ? bodyData : undefined;

  const fetchOptions: any = {
    method: 'PUT',
    body: requestBody,
    headers: options.headers,
  };

    return this.api.fetch(url, fetchOptions);
}

/**
 * Delete a product
 *
 * @param {string} productId The product ID
 * @param {Object} options (optional) - Request options
 *
 * @returns {Promise<any>} DELETE /products/{productId} response
 */
export function deleteProduct(this: any, productId: string) {
  let url = '/products/{productId}';
  if (productId) {
    url = url.replace('{productId}', productId);
  }

  return this.api.fetch(url, {
    method: 'DELETE',
  });
    return this.api.fetch(url, fetchOptions);
}