import { describe, it, expect } from 'vitest';
import { CicdExtractor, isCicdFile } from '../src/extraction/cicd-extractor';
import { parseYamlWithLocations } from '../src/extraction/yaml-utils';

describe('AFYX-212: CI/CD Pipeline Intelligence Extractor', () => {
  it('identifies CI/CD pipeline configuration files', () => {
    expect(isCicdFile('.github/workflows/ci.yml')).toBe(true);
    expect(isCicdFile('.github/workflows/deploy.yaml')).toBe(true);
    expect(isCicdFile('.gitlab-ci.yml')).toBe(true);
    expect(isCicdFile('Jenkinsfile')).toBe(true);
    expect(isCicdFile('ci/Jenkinsfile')).toBe(true);
    expect(isCicdFile('azure-pipelines.yml')).toBe(true);

    // Negative tests
    expect(isCicdFile('docker-compose.yml')).toBe(false);
    expect(isCicdFile('.eslintrc.yml')).toBe(false);
    expect(isCicdFile('README.md')).toBe(false);
  });

  it('extracts GitHub Actions triggers, jobs, dependencies (needs), and steps', () => {
    const ghaSource = `
name: Build and Test

on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run linter
        run: npm run lint

  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run unit tests
        run: npm test

  deploy:
    needs: [lint, test]
    runs-on: ubuntu-latest
    env:
      DEPLOY_KEY: \${{ secrets.PROD_DEPLOY_KEY }}
      AWS_SECRET_ACCESS_KEY: my-super-secret-key-leaked
    steps:
      - name: Deploy to Cloud
        run: ./deploy.sh
`;

    const extractor = new CicdExtractor('.github/workflows/ci.yml', ghaSource);
    const result = extractor.extract();

    const jobNodes = result.nodes.filter((n) => n.kind === 'component');
    const jobNames = jobNodes.map((n) => n.name);
    expect(jobNames).toContain('lint');
    expect(jobNames).toContain('test');
    expect(jobNames).toContain('deploy');

    const lintNode = jobNodes.find((n) => n.name === 'lint');
    const testNode = jobNodes.find((n) => n.name === 'test');
    const deployNode = jobNodes.find((n) => n.name === 'deploy');

    // test needs lint
    const testToLint = result.edges.find(
      (e) => e.source === testNode?.id && e.target === lintNode?.id && e.kind === 'references'
    );
    expect(testToLint).toBeDefined();

    // deploy needs lint and test
    const deployToTest = result.edges.find(
      (e) => e.source === deployNode?.id && e.target === testNode?.id && e.kind === 'references'
    );
    expect(deployToTest).toBeDefined();

    // Secret redaction in GHA env
    const awsSecretNode = result.nodes.find((n) => n.name === 'AWS_SECRET_ACCESS_KEY');
    expect(awsSecretNode).toBeDefined();
    expect(awsSecretNode?.signature).toContain('[REDACTED]');
    expect(awsSecretNode?.signature).not.toContain('my-super-secret-key-leaked');

    // uses action references
    const checkoutRef = result.unresolvedReferences.find((r) => r.referenceName === 'actions/checkout@v4');
    expect(checkoutRef).toBeDefined();
  });

  it('extracts GitLab CI stages, jobs, and needs/extends dependencies', () => {
    const gitlabSource = `
stages:
  - build
  - test
  - deploy

.template:
  image: node:20

compile:
  stage: build
  extends: .template
  script:
    - npm run build

unit-test:
  stage: test
  needs: [compile]
  script:
    - npm test
`;

    const extractor = new CicdExtractor('.gitlab-ci.yml', gitlabSource);
    const result = extractor.extract();

    const jobNodes = result.nodes.filter((n) => n.kind === 'component');
    const jobNames = jobNodes.map((n) => n.name);
    expect(jobNames).toContain('compile');
    expect(jobNames).toContain('unit-test');

    const compileNode = jobNodes.find((n) => n.name === 'compile');
    const testNode = jobNodes.find((n) => n.name === 'unit-test');

    const testNeedsCompile = result.edges.find(
      (e) => e.source === testNode?.id && e.target === compileNode?.id && e.kind === 'references'
    );
    expect(testNeedsCompile).toBeDefined();
  });

  it('extracts Jenkins declarative pipeline stages', () => {
    const jenkinsSource = `
pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        sh 'mvn clean compile'
      }
    }
    stage('Test') {
      steps {
        sh 'mvn test'
      }
    }
  }
}
`;

    const extractor = new CicdExtractor('Jenkinsfile', jenkinsSource);
    const result = extractor.extract();

    const stageNodes = result.nodes.filter((n) => n.kind === 'component');
    const stageNames = stageNodes.map((n) => n.name);
    expect(stageNames).toContain('Build');
    expect(stageNames).toContain('Test');
  });

  it('extracts Azure Pipelines stages and jobs', () => {
    const azureSource = `
trigger:
  - main

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - script: npm run build
  - stage: Test
    dependsOn: Build
    jobs:
      - job: TestJob
        steps:
          - script: npm test
`;

    const extractor = new CicdExtractor('azure-pipelines.yml', azureSource);
    const result = extractor.extract();

    const stageNodes = result.nodes.filter((n) => n.kind === 'namespace');
    const stageNames = stageNodes.map((n) => n.name);
    expect(stageNames).toContain('Build');
    expect(stageNames).toContain('Test');
  });
});
