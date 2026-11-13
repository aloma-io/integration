// stands in for AbstractController from @aloma.io/integration-sdk
export class AbstractController {
  protected config: any = {};
  async inheritedPublic(): Promise<void> {}
}

export const SHARED_LIMIT = 3;
