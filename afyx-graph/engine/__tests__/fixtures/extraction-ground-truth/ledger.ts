import { helper } from './helper';

export class Ledger {
  total(value: number): number {
    return helper(value);
  }
}

const decoy = "function ghost() {}";
// function phantom() {}
