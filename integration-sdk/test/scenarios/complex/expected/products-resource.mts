// ProductsResource resource functions
// These functions will be bound to the controller instance and accessible as products.method()
import {callOperation} from '@aloma.io/integration-sdk';
import type {OperationDescriptor} from '@aloma.io/integration-sdk';

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

const OPERATIONS: {[name: string]: OperationDescriptor} = {
  "getProducts": {"method":"GET","path":"/products","pathParams":[],"query":[{"name":"limit"},{"name":"category"},{"name":"archived"}],"headers":[],"body":null},
  "createProduct": {"method":"POST","path":"/products","pathParams":[],"query":[],"headers":[],"body":{"mode":"flat","contentType":"application/json","fields":["name","description","price","category","tags"]}},
  "getProduct": {"method":"GET","path":"/products/{productId}","pathParams":["productId"],"query":[],"headers":[],"body":null},
  "updateProduct": {"method":"PUT","path":"/products/{productId}","pathParams":["productId"],"query":[],"headers":[],"body":{"mode":"flat","contentType":"application/json","fields":["name","description","price","category","inStock","tags"]}},
  "deleteProduct": {"method":"DELETE","path":"/products/{productId}","pathParams":["productId"],"query":[],"headers":[],"body":null},
};

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
 * await connectors.testShop.productsGetProducts({})
 * ```
 *
 * @returns {Promise<ProductList>} GET /products response
 *
 * response fields:
 * - products?: Product[]
 * - total?: number - Total number of products
 * - hasMore?: boolean - Whether there are more products available
 */
export function getProducts(this: any, {limit, category, archived, headers}: {limit?: number; category?: string; archived?: boolean; headers?: Record<string, string>} = {}) {
  return callOperation(this.api, OPERATIONS.getProducts, {limit, category, archived, headers});
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
 * await connectors.testShop.productsCreateProduct({ name: "name-value", price: 1 })
 * ```
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
export function createProduct(this: any, {name, description, price, category, tags, headers}: {name: string; description?: string; price: number; category?: string; tags?: string[]; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.createProduct, {name, description, price, category, tags, headers});
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
 * await connectors.testShop.productsGetProduct({ productId: "productId-1" })
 * ```
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
export function getProduct(this: any, {productId, headers}: {productId: string; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.getProduct, {productId, headers});
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
 * await connectors.testShop.productsUpdateProduct({ productId: "productId-1" })
 * ```
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
export function updateProduct(this: any, {productId, name, description, price, category, inStock, tags, headers}: {productId: string; name?: string; description?: string; price?: number; category?: string; inStock?: boolean; tags?: string[]; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.updateProduct, {productId, name, description, price, category, inStock, tags, headers});
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
 * await connectors.testShop.productsDeleteProduct({ productId: "productId-1" })
 * ```
 *
 * @returns {Promise<any>} DELETE /products/{productId} response
 */
export function deleteProduct(this: any, {productId, headers}: {productId: string; headers?: Record<string, string>}) {
  return callOperation(this.api, OPERATIONS.deleteProduct, {productId, headers});
}
