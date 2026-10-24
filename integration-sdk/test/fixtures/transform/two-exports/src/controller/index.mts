import {AbstractController} from './abstract.mjs';

export interface Extra {
  a: string;
}

export default class Controller extends AbstractController {
  async one() {}
}
