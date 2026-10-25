import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  async one(): Promise<number> {
    return 'not a number';
  }
}
