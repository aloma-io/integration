import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  async visible({a}: {a: string}) {
    return a;
  }
  private async hidden({a}: {a: string}) {}
  protected async guarded({a}: {a: string}) {}
  static async stat({a}: {a: string}) {}
  async _underscore({a}: {a: string}) {}
  async 'quoted-name'({a}: {a: string}) {}
  async '_quoted_private'({a}: {a: string}) {}
  arrow = async ({a}: {a: string}) => a;
  notAMethod = 5;
  get getter() {
    return 1;
  }
  override async inheritedPublic() {}
}
