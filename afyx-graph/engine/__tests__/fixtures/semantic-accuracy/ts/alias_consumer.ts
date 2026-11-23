import { validateOrder as verifyOrder } from './validator';
import { Order } from './types';

export function runValidation(order: Order): boolean {
  return verifyOrder(order);
}

