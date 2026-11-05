import { Order } from './types';

export function validateOrder(order: Order): boolean {
  return order.total > 0;
}

