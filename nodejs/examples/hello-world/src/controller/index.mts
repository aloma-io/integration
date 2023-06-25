import {AbstractController} from '@aloma.io/integration-sdk';

export default class Controller extends AbstractController {
  
  /**
   * say hello
   */
  async hello(args: any)
  {
    return "hello world";
  }
}
