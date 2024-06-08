import Fetcher from '../internal/fetcher/fetcher.mjs';
import {OAuth} from '../internal/fetcher/oauth-fetcher.mjs';

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

  protected configQuery(arg: any): Promise<any> {
    return Promise.resolve({});
  }

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
  protected autocomplete(arg: any): Promise<any> {
    return Promise.resolve({});
  }

  /**
   * called, when the remote public method is not found on the controller
   * @param arg
   */
  protected fallback(arg: any): Promise<any> {
    throw new Error('method not found');
  }

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
  protected async configCheck(configSchema: any): Promise<any> {
    // blank, throw an error if the config is not valid
  }

  async __endpoint(arg: any): Promise<any | null> {
    return this.endpoint(arg);
  }

  async __configQuery(arg: any): Promise<any | null> {
    return this.configQuery(arg);
  }

  async __autocomplete(arg: any): Promise<any | null> {
    return this.autocomplete(arg);
  }

  async __default(arg: any): Promise<any | null> {
    return this.fallback(arg);
  }

  async __healthCheck(configSchema: any): Promise<any> {
    await this.healthCheck();
    await this.configCheck(configSchema);
  }

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

  async _doStop(isShutdown: boolean = false): Promise<void> {
    await this.stop(isShutdown);
  }
}
