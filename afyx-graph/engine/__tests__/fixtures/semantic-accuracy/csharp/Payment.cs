namespace FinanceApp;

public interface ITransactionService {
    bool Process(decimal amount);
}

public class TransactionService : ITransactionService {
    public bool Process(decimal amount) => amount > 0;
}

public class OrderHandler {
    public bool Complete(ITransactionService service) {
        return service.Process(100.0m);
    }
}

