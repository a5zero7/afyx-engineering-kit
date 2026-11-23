pub trait PaymentGateway {
    fn authorize(&self, amount: u64) -> bool;
}

pub struct StripeClient;

impl PaymentGateway for StripeClient {
    fn authorize(&self, amount: u64) -> bool {
        amount > 0
    }
}

pub fn run_charge(client: &StripeClient, amount: u64) -> bool {
    client.authorize(amount)
}

