import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  /** first form */
  async over({a}: {a: string}): Promise<string>;
  /** second form */
  async over({b}: {b: number}): Promise<number>;
  async over(args: any): Promise<any> {
    return args;
  }
}
