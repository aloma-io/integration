export abstract class AbstractController {
  protected config;
  protected client;

  protected async start(): Promise<void> {}

  protected async stop(): Promise<void> {}

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

  protected getClient({ baseUrl, onResponse }: { baseUrl: string, onResponse?: (response: any) => void }): Promise<any> {
    throw new Error("not implemented");
  }

  protected async updateTask(name: string, data: any): Promise<string> {
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
  ): Promise<void> {
    this.config = config;
    this.client = client;
    this.newTask = newTask;
    this.updateTask = updateTask;
    this.getClient = getClient;

    await this.start();
  }

  async _doStop(): Promise<void> {
    await this.stop();
  }
}
