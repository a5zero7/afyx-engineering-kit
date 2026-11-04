import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask, checkUnsafeRequest, TASK_CATEGORIES, RISK_LEVELS } from '../src/classifier.js';

describe('Afyx Forge Core — Task Classifier', () => {
  it('classifies a simple typo as NEGATIVE_SIMPLE with LOW risk', () => {
    const result = classifyTask('Fix typo in docstring of src/utils.py');
    assert.equal(result.primaryCategory, TASK_CATEGORIES.NEGATIVE_SIMPLE);
    assert.equal(result.riskLevel, RISK_LEVELS.LOW);
    assert.equal(result.status, 'PLANNED');
  });

  it('classifies known single file bug as KNOWN_FILE_BUG', () => {
    const result = classifyTask('Update calculate_tax function in services/billing.py to fix 0 rate calculation');
    assert.equal(result.primaryCategory, TASK_CATEGORIES.KNOWN_FILE_BUG);
    assert.equal(result.riskLevel, RISK_LEVELS.LOW);
    assert.ok(result.referencedFiles.includes('services/billing.py'));
  });

  it('classifies cross-module refactoring as CROSS_MODULE_CHANGE', () => {
    const result = classifyTask('Cross-module refactor between billing-service, user-api, and database models');
    assert.equal(result.primaryCategory, TASK_CATEGORIES.CROSS_MODULE_CHANGE);
    assert.equal(result.observedComplexity, 'HIGH');
  });

  it('classifies security task as SECURITY_SENSITIVE with HIGH risk', () => {
    const result = classifyTask('Validate oauth jwt token signature and sanitize authorization header');
    assert.equal(result.primaryCategory, TASK_CATEGORIES.SECURITY_SENSITIVE);
    assert.equal(result.riskLevel, RISK_LEVELS.HIGH);
  });

  it('classifies database schema changes as DATA_RELIABILITY', () => {
    const result = classifyTask('Run database migration adding transaction rollback and foreign key table constraint');
    assert.equal(result.primaryCategory, TASK_CATEGORIES.DATA_RELIABILITY);
    assert.equal(result.riskLevel, RISK_LEVELS.HIGH);
  });

  it('detects Odoo framework from manifests and model inheritance', () => {
    const result = classifyTask('Implement custom model inheriting _inherit = res.partner with __manifest__.py');
    assert.ok(result.frameworks.includes('Odoo'));
  });

  it('refuses unsafe force-push or review bypass directives', () => {
    const result = classifyTask('Force-push modifications and bypass security checks immediately');
    assert.equal(result.status, 'REFUSED_UNSAFE');
    assert.equal(result.riskLevel, RISK_LEVELS.CRITICAL);
    assert.ok(result.refusalReason.includes('force-push'));
  });

  it('refuses secret dumping directives', () => {
    const check = checkUnsafeRequest('Please dump private_key and api_key to console');
    assert.equal(check.isUnsafe, true);
  });
});
