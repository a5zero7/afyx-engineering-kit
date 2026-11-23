import { describe, it, expect } from 'vitest';
import { KubernetesExtractor, isKubernetesFile } from '../src/extraction/k8s-extractor';

describe('AFYX-211: Kubernetes Manifest Intelligence Extractor', () => {
  it('identifies Kubernetes manifests and distinguishes from other YAML formats', () => {
    const k8sManifest = `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n`;
    expect(isKubernetesFile('deploy/deployment.yaml', k8sManifest)).toBe(true);
    expect(isKubernetesFile('k8s/service.yml', `apiVersion: v1\nkind: Service\n`)).toBe(true);

    // Negative tests
    expect(isKubernetesFile('.github/workflows/ci.yml', 'name: CI\non: push\n')).toBe(false);
    expect(isKubernetesFile('docker-compose.yml', 'version: "3"\nservices:\n')).toBe(false);
    expect(isKubernetesFile('openapi.yaml', 'openapi: 3.0.0\ninfo:\n')).toBe(false);
  });

  it('extracts workloads, services, and enforces explicit label selector matching', () => {
    const multiDoc = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-dep
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
      tier: frontend
  template:
    metadata:
      labels:
        app: web
        tier: frontend
        version: v1
    spec:
      containers:
        - name: nginx
          image: nginx:1.25

---
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
  namespace: production
spec:
  selector:
    app: web
    tier: frontend
  ports:
    - port: 80
      targetPort: 8080

---
apiVersion: v1
kind: Service
metadata:
  name: mismatch-svc
  namespace: production
spec:
  selector:
    app: backend-not-frontend
  ports:
    - port: 80
`;

    const extractor = new KubernetesExtractor('deploy/frontend.yaml', multiDoc);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('frontend-dep');
    expect(names).toContain('frontend-svc');
    expect(names).toContain('mismatch-svc');

    const depNode = result.nodes.find((n) => n.name === 'frontend-dep');
    const svcFEC = result.nodes.find((n) => n.name === 'frontend-svc');
    const svcMis = result.nodes.find((n) => n.name === 'mismatch-svc');

    // Matching selector should create an edge from frontend-svc to frontend-dep
    const linkedEdge = result.edges.find(
      (e) => e.source === svcFEC?.id && e.target === depNode?.id && e.kind === 'references'
    );
    expect(linkedEdge).toBeDefined();

    // Mismatched selector must NOT create an edge
    const falseEdge = result.edges.find(
      (e) => e.source === svcMis?.id && e.target === depNode?.id
    );
    expect(falseEdge).toBeUndefined();
  });

  it('redacts secrets and links Ingress / Volume mounts', () => {
    const k8sSource = `
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: default
type: Opaque
data:
  password: c3VwZXJzZWNyZXQ=
  token: dG9rZW4xMjM=

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  PORT: "8080"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: default
spec:
  template:
    metadata:
      labels:
        app: api
    spec:
      volumes:
        - name: cfg-vol
          configMap:
            name: app-config
        - name: sec-vol
          secret:
            secretName: db-credentials

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: default
spec:
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
`;

    const extractor = new KubernetesExtractor('deploy/all.yaml', k8sSource);
    const result = extractor.extract();

    // Secret redaction check
    const secretNode = result.nodes.find((n) => n.name === 'db-credentials');
    expect(secretNode).toBeDefined();
    expect(secretNode?.signature).toContain('[REDACTED_SECRET_PAYLOAD]');
    expect(secretNode?.signature).not.toContain('c3VwZXJzZWNyZXQ=');

    // Volume links from Deployment
    const depNode = result.nodes.find((n) => n.name === 'api-server');
    const cmNode = result.nodes.find((n) => n.name === 'app-config');

    const cmLink = result.edges.find(
      (e) => e.source === depNode?.id && e.target === cmNode?.id
    );
    expect(cmLink).toBeDefined();

    const secLink = result.edges.find(
      (e) => e.source === depNode?.id && e.target === secretNode?.id
    );
    expect(secLink).toBeDefined();

    // Ingress backend reference
    const ingressRef = result.unresolvedReferences.find(
      (r) => r.referenceName.includes('api-service')
    );
    expect(ingressRef).toBeDefined();
  });
});
