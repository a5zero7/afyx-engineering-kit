import { describe, it, expect } from 'vitest';
import { springResolver } from '../src/resolution/frameworks/java';

describe('AFYX-220: Spring Framework Graph Intelligence & DI', () => {
  it('extracts @Autowired field injection, constructor injection, and component classes', () => {
    const javaSource = `
package com.example.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    @Autowired
    private PaymentGateway paymentGateway;
}

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;
    private final UserRepository userRepo;

    public OrderController(OrderService orderService, UserRepository userRepo) {
        this.orderService = orderService;
        this.userRepo = userRepo;
    }

    @GetMapping("/{id}")
    public Order getOrder() {
        return null;
    }
}
`;

    const result = springResolver.extract!('com/example/OrderController.java', javaSource);

    // Verify route node
    const routeNode = result.nodes.find((n) => n.kind === 'route');
    expect(routeNode?.name).toBe('GET /api/orders/{id}');

    // Verify DI references
    const refNames = result.references.map((r) => r.referenceName);

    // 1. @Autowired field injection
    expect(refNames).toContain('PaymentGateway');

    // 2. Constructor injection
    expect(refNames).toContain('OrderService');
    expect(refNames).toContain('UserRepository');
  });

  it('strictly preserves #383 secret safety in application.properties and application.yml', () => {
    const propsSource = `
server.port=8080
spring.datasource.password=SuperSecretPassword123
api.key=sk-live-abcdef1234567890
`;
    const resProps = springResolver.extract!('src/main/resources/application.properties', propsSource);

    expect(resProps.nodes.length).toBeGreaterThan(0);
    for (const node of resProps.nodes) {
      expect(node.signature).not.toContain('SuperSecretPassword123');
      expect(node.signature).not.toContain('sk-live-abcdef');
    }

    const yamlSource = `
spring:
  datasource:
    password: AnotherTopSecretPassword
    url: jdbc:postgresql://localhost:5432/db
`;
    const resYaml = springResolver.extract!('src/main/resources/application.yml', yamlSource);
    expect(resYaml.nodes.length).toBeGreaterThan(0);
    for (const node of resYaml.nodes) {
      expect(node.signature).not.toContain('AnotherTopSecretPassword');
    }
  });
});
