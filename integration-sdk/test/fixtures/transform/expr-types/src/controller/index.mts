import {AbstractController} from './abstract.mjs';

type Keys = {a: string; b: number};

type Shapes = {
  pair: [string, number];
  optional: [string, number?];
  rest: [string, ...number[]];
  list: string[];
  either: (string | number)[];
  wrapped: (string | number);
  grid: boolean[][];
};

export default class Controller extends AbstractController {
  async shapes({pair}: Shapes): Promise<void> {}

  /**
   * @returns {[first: string, second: number]}
   */
  async docNamed({a}: Keys): Promise<any> {}

  /**
   * @returns {(string | number)}
   */
  async docParen({a}: Keys): Promise<any> {}

  async pick<T extends Keys, K extends keyof T>({a}: Keys, key: K, from: T): Promise<T[K]> {
    return from[key];
  }

  async pairBack({a}: Keys): Promise<[string, number?]> {
    return ['x'];
  }
}
