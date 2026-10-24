import {AbstractController} from './abstract.mjs';

interface Opts {
  id: string;
  n?: number;
}

export default class Controller extends AbstractController {
  async viaInterface({id, n}: Opts): Promise<{id: string; n: number | undefined}> {
    return {id, n};
  }
}
