import { stepA } from './circular_a';

export function stepB(): number {
  return stepA() > 10 ? 0 : stepA();
}

