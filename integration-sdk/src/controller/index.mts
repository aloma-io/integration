import { ConfigField } from '../index.mjs';
import Fetcher from '../internal/fetcher/fetcher.mjs';
import { OAuth } from '../internal/fetcher/oauth-fetcher.mjs';

/**
 * Abstract controller class
 * this needs to be used in a connector
 */
export abstract class AbstractController {
  /**
   * connector configuration
   */
  protected config: {[key: string]: any} = {};

  /**
   * @deprecated
   */
  protected client: any;

  /**
   * oauth data, if the connector is using oauth
   */
  protected oauth?: OAuth;

  /**
   * invoked, when the controller is started
   */
  protected async start(): Promise<void> {}

  /**
   * invoked, when the controller is stopped
   * @param isShutdown true if the controller is stopped due to shutdown
   */
  protected async stop(isShutdown: boolean = false): Promise<void> {}

  /**
   * autocomplete configuration options
   *
   * e.g. if this connector is connected to a system which has multiple entities with dynamic attributes, like deals, ...
   * then this method should return the possible attributes of the entity when invoked like
   * ```javascript
   * autocomplete({entity: 'deal'})
   * ```
   * @param arg
   * @returns
   */
  protected async autocomplete(arg: any): Promise<any> {
    return Promise.resolve({});
  }

  /**
   * called, when the remote public method is not found on the controller
   * @param arg
   */
  protected fallback(arg: any): Promise<any> {
    throw new Error('method not found');
  }

  /**
   * will be invoked, when the connector has an endpoint enabled
   * will receive the data and can e.g. create a new task from it
   * @param arg
   */
  protected async endpoint(arg: any): Promise<any> {
    throw new Error('method not found');
  }

  /**
   * create a new task
   * @param name name of the task
   * @param data data of the task
   */
  protected async newTask(name: string, data: any): Promise<string> {
    throw new Error('not implemented');
  }

  /**
   * get a client to make requests
   * @param baseUrl base url of the client
   * @param onResponse callback to be invoked on response
   * @param customize callback to customize the request
   */
  protected getClient({
    baseUrl,
    onResponse,
    customize,
  }: {
    baseUrl?: string;
    onResponse?: (response: any) => void;
    customize?: (request: any) => void;
  }): Fetcher {
    throw new Error('not implemented');
  }

  /**
   * update a task
   * @param name name of the task
   * @param data partial data of the task to update
   * @returns taskId
   */
  protected async updateTask(name: string, data: any): Promise<string> {
    throw new Error('not implemented');
  }

  /**
   * create a blob
   * @param content content of the blob in base64
   * @param name name of the blob
   * @param size size of the blob
   * @param mimetype mimetype of the blob
   * @param meta meta data of the blob
   * @param taskId id of the task
   */
  protected async createBlob({
    content,
    name,
    size,
    mimetype,
    meta,
    taskId,
  }: {
    content: string;
    name?: string;
    size?: number;
    mimetype?: string;
    meta?: any;
    taskId?: string;
  }): Promise<string> {
    throw new Error('not implemented');
  }

  /**
   * get the metadata of a blob by id
   * @param id blob id
   */
  protected async getBlob(id: string): Promise<{
    name?: string;
    id;
    size?: number;
    mimetype?: string;
    meta?: any;
  }> {
    throw new Error('not implemented');
  }

  /**
   * get the content of a blob by id as base64
   * @param id blob id
   */
  protected async getBlobContent(id: string): Promise<string> {
    throw new Error('not implemented');
  }

  /**
   * health check, will be called periodically
   * throw an error if unhealthy with a message describing what needs to be fixed
   */
  protected async healthCheck(): Promise<any> {
    // blank, throw an error if unhealthy
  }

  /**
   * config check, will be called periodically
   * throw an error if the config is not valid
   *
   * @param configSchema the schema of the config
   */
  protected async configCheck(configSchema: {[key: string]: ConfigField}): Promise<void> {
    // blank, throw an error if the config is not valid
  }

  /**
   * @ignore
   **/
  async __endpoint(arg: any): Promise<any | null> {
    return this.endpoint(arg);
  }

  /**
   * @ignore
   **/
  async __autocomplete(arg: any): Promise<any | null> {
    return this.autocomplete(arg);
  }

  /**
   * @ignore
   **/
  async __default(arg: any): Promise<any | null> {
    return this.fallback(arg);
  }

  /**
   * @ignore
   **/
  async __healthCheck(configSchema: () => {[key: string]: ConfigField}): Promise<void> {
    const errors: string[] = [];
    const schema = configSchema();
    const fields: any = schema.fields;

    try {
      await this.healthCheck();
    } catch (e: any) {
      errors.push(e.message);
    }

    try {
      await this.defaultConfigCheck(fields);
    } catch (e: any) {
      errors.push(e.message);
    }

    try {
      await this.configCheck(fields);
    } catch (e: any) {
      errors.push(e.message);
    }

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
  }

  /**
   * @ignore
   **/
  private async defaultConfigCheck(configSchema: {[key: string]: ConfigField}): Promise<void> {
    const config = this.config;

    const missing = Object.entries(configSchema)
      .map(([key, field]) => {
        if (!field) return;

        if (!field.optional && config[key] == null) {
          return `Configuration: ${field.name || key} is required`;
        }
      })
      .filter((what) => !!what);

    if (missing.length) {
      throw new Error(missing.join('\n'));
    }
  }

  /**
   * @ignore
   **/
  async _doStart(
    config: any,
    oauth: any,
    newTask: any,
    updateTask: any,
    getClient: any,
    getBlob: any,
    getBlobContent: any,
    createBlob: any
  ): Promise<void> {
    this.config = config;
    this.client = oauth;
    this.oauth = oauth;
    this.newTask = newTask;
    this.updateTask = updateTask;
    this.getClient = getClient;
    this.createBlob = createBlob;
    this.getBlob = getBlob;
    this.getBlobContent = getBlobContent;

    await this.start();
  }

  /**
   * @ignore
   **/
  async _doStop(isShutdown: boolean = false): Promise<void> {
    await this.stop(isShutdown);
  }
}
