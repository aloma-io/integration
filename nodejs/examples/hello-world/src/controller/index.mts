import {AbstractController} from '@aloma.io/integration-sdk';

export default class Controller extends AbstractController {
  private knex: any;

  /**
   * say hello
   */
  async hello(args: any)
  {
    return "hello world";
  }
}
