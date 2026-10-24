import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  /**
   * greet somebody
   * @param name - who to greet, e.g. Ann
   * @param times - how often
   * @param opts - extra \@options
   * @namespace demo
   *
   * @example
   * ```javascript
   * greet({name: 'Ann'})
   * ```
   */
  async greet({name, times = 2, loud = false, label = 'x', neg = -1, nothing = null}, other = 1) {
    return {ok: true, greeting: name + times};
  }

  /** no params */
  async ping() {
    return {ok: true};
  }

  async list(): Promise<string[]> {
    return [];
  }

  async nothing(): Promise<void> {}
}
