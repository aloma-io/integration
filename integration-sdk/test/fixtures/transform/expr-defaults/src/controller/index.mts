import ts from 'typescript';
import {AbstractController, SHARED_LIMIT} from './abstract.mjs';

const LOCAL_NAME = 'local';

export default class Controller extends AbstractController {
  static readonly LIMIT = 10;

  async unary({
    neg = -5,
    plus = +5,
    not = !true,
    word = 'x' as const,
    paren = (7),
    asserted = 8 as number,
    bitwise = ~5,
    notNull = !null,
  }: {
    neg?: number;
    plus?: number;
    not?: boolean;
    word?: string;
    paren?: number;
    asserted?: number;
    bitwise?: number;
    notNull?: boolean;
  }): Promise<void> {}

  async named({
    local = LOCAL_NAME,
    own = Controller.LIMIT,
    imported = SHARED_LIMIT,
    thirdParty = ts.version,
    nothing = null,
    missing = undefined,
  }: {
    local?: string;
    own?: number;
    imported?: number;
    thirdParty?: string;
    nothing?: null;
    missing?: undefined;
  }): Promise<void> {}
}
