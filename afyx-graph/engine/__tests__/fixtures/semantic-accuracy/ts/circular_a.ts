import { stepB } from './circular_b';

export function stepA(): number {
  return stepB() + 1;
}

