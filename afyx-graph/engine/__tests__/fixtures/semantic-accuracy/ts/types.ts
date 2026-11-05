export interface Order {
  id: string;
  total: number;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
}

export type PaymentId = string;

