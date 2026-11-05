import { Order, PaymentResult } from './types';
import { validateOrder } from './validator';

export class PaymentProcessor {
  processPayment(order: Order): PaymentResult {
    const isValid = validateOrder(order);
    return {
      success: isValid,
      transactionId: 'tx-123',
    };
  }
}

