import { Base, shared as chosen } from './right';
import * as right from './right';

export class Child extends Base {}

export function aliasCaller(): string {
  return chosen();
}

export function qualifiedCaller(): string {
  return right.shared();
}

export function unknownCaller(): unknown {
  return missingTarget();
}
