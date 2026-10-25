import {AbstractController} from './abstract.mjs';

export default class Controller extends AbstractController {
  async typed({email, count, tags, mode, either, nested}: {email: string; count?: number; tags: string[]; mode: 'a' | 'b'; either: string | number; nested: {x: number}}) {
    return {ok: true, tags: [1, 2]};
  }
  async tuple(): Promise<[string, number]> {
    return ['a', 1];
  }
  async maybe(): Promise<string | undefined> {
    return undefined;
  }
}
