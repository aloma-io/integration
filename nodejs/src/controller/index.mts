export abstract class AbstractController {
  protected config;
  protected client;

  protected async start(): Promise<void> {}

  protected async stop(isShutdown: boolean = false): Promise<void> {}

  protected configQuery(arg: any): Promise<any> {
    return Promise.resolve({});
  }

  protected fallback(arg: any): Promise<any> {
    throw new Error("method not found");
  }

  protected async endpoint(arg: any): Promise<any> {
    throw new Error("method not found");
  }

  protected async newTask(name: string, data: any): Promise<string> {
    throw new Error("not implemented");
  }

  protected getClient({
    baseUrl,
    onResponse,
    customize,
  }: {
    baseUrl?: string;
    onResponse?: (response: any) => void;
    customize?: (request: any) => void;
  }): Promise<any> {
    throw new Error("not implemented");
  }

  protected async updateTask(name: string, data: any): Promise<string> {
    throw new Error("not implemented");
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
    throw new Error("not implemented");
  }

  protected async getBlob(id: string): Promise<{
    name?: string;
    id;
    size?: number;
    mimetype?: string;
    meta?: any;
  }> {
    throw new Error("not implemented");
  }

  protected async getBlobContent(id: string): Promise<string> {
    throw new Error("not implemented");
  }

  async __endpoint(arg: any): Promise<any | null> {
    return this.endpoint(arg);
  }

  async __configQuery(arg: any): Promise<any | null> {
    return this.configQuery(arg);
  }

  async __default(arg: any): Promise<any | null> {
    return this.fallback(arg);
  }

  async _doStart(
    config: any,
    client: any,
    newTask: any,
    updateTask: any,
    getClient: any,
    getBlob: any,
    getBlobContent: any,
    createBlob: any,
  ): Promise<void> {
    this.config = config;
    this.client = client;
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
