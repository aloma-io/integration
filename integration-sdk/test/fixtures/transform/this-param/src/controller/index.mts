import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  async withThis(this: Controller, {id}: {id: string}): Promise<string> {
    return id;
  }
}
