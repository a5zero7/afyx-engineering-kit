package com.example;

public interface AccountService {
    double getBalance(String id);
}

public class DefaultAccountService implements AccountService {
    public double getBalance(String id) {
        return 42.0;
    }
}

public class AccountController {
    public double query(AccountService svc, String id) {
        return svc.getBalance(id);
    }
}

