import {AbstractController} from './abstract.mjs';

type Alias = {
  zeta: string;
  alpha: number[];
  mid: boolean | null;
};

interface Shape {
  second: string;
  first: number;
}

export default class Controller extends AbstractController {
  async viaAlias({zeta}: Alias): Promise<void> {}
  async viaShape({second}: Shape): Promise<void> {}
}
