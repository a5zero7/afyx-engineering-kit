import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { extractFromSource } from '../src/extraction/extract';
import { isSourceFile, detectLanguage } from '../src/extraction/grammars';
import {
  isOdooManifest,
  isOdooAccessCsv,
  isOdooXml,
  OdooManifestExtractor,
  OdooAccessCsvExtractor,
  OdooSecurityXmlExtractor,
} from '../src/extraction/odoo';

describe('TASK G8.1 — Native Odoo Security & Configuration Asset Indexing', () => {
  describe('1. File Discovery & Language Routing Contract', () => {
    it('recognizes __manifest__.py as source file and routes to python', () => {
      expect(isSourceFile('my_module/__manifest__.py')).toBe(true);
      expect(detectLanguage('my_module/__manifest__.py')).toBe('python');
      expect(isOdooManifest('my_module/__manifest__.py')).toBe(true);
      expect(isOdooManifest('my_module/__openerp__.py')).toBe(true);
      expect(isOdooManifest('my_module/models/test.py')).toBe(false);
    });

    it('recognizes ir.model.access.csv as source file and routes to csv', () => {
      expect(isSourceFile('my_module/security/ir.model.access.csv')).toBe(true);
      expect(isSourceFile('ir.model.access.csv')).toBe(true);
      expect(isSourceFile('ir.model.access.test.csv')).toBe(true);
      expect(detectLanguage('my_module/security/ir.model.access.csv')).toBe('csv');
      expect(isOdooAccessCsv('my_module/security/ir.model.access.csv')).toBe(true);
      expect(isOdooAccessCsv('my_module/security/access_rules.csv')).toBe(true);
      // Non-Odoo CSV outside security is NOT source file
      expect(isOdooAccessCsv('data/sales_export.csv')).toBe(false);
      expect(isSourceFile('data/sales_export.csv')).toBe(false);
    });

    it('recognizes Odoo security XML by content and directory structure', () => {
      expect(isOdooXml('<odoo><record id="r1" model="ir.rule"/></odoo>', 'security/rules.xml')).toBe(true);
      expect(isOdooXml('<openerp><data/></openerp>', 'data.xml')).toBe(true);
      expect(isOdooXml('<record id="r1" model="ir.rule"/>', 'any_path.xml')).toBe(true);
      // Non-Odoo XML (MyBatis or Maven)
      expect(isOdooXml('<mapper namespace="com.test.Dao"/>', 'mapper.xml')).toBe(false);
      expect(isOdooXml('<project xmlns="http://maven.apache.org/POM/4.0.0"/>', 'pom.xml')).toBe(false);
    });
  });

  describe('2. Odoo Manifest Extraction (__manifest__.py)', () => {
    it('extracts valid manifest identity, dependencies, and data files', () => {
      const manifestContent = `{
    "name": "Synthetic Purchase Request Fixture",
    "version": "17.0.1.0.0",
    "depends": ["purchase", "mail"],
    "data": [
        "security/purchase_request_security.xml",
        "security/ir.model.access.csv",
    ],
    "license": "LGPL-3",
    "author": "Afyx Engineering",
    "summary": "Purchase Request Workflow Fixture",
}`;

      const result = extractFromSource('purchase_request_fixture/__manifest__.py', manifestContent);

      expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
      expect(result.nodes).toHaveLength(1);

      const moduleNode = result.nodes[0]!;
      expect(moduleNode.kind).toBe('module');
      expect(moduleNode.name).toBe('Synthetic Purchase Request Fixture');
      expect(moduleNode.qualifiedName).toBe('purchase_request_fixture::manifest');
      expect(moduleNode.signature).toContain('17.0.1.0.0');
      expect(moduleNode.docstring).toContain('LGPL-3');
      expect(moduleNode.docstring).toContain('Afyx Engineering');

      // Dependencies
      const depRefs = result.unresolvedReferences.filter((r) => r.referenceKind === 'imports');
      expect(depRefs.map((r) => r.referenceName)).toEqual(['purchase', 'mail']);

      // Data files
      const dataRefs = result.unresolvedReferences.filter((r) => r.referenceKind === 'references');
      expect(dataRefs.map((r) => r.referenceName)).toEqual([
        'security/purchase_request_security.xml',
        'security/ir.model.access.csv',
      ]);
    });

    it('safely handles malformed / invalid manifests without crashing', () => {
      const invalidManifest = `{ "name": "Broken Manifest", "depends": ["purchase" `;
      const result = extractFromSource('broken/__manifest__.py', invalidManifest);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.severity).toBe('error');
      // Should not throw and should gracefully return
      expect(result.nodes).toBeDefined();
    });

    it('explicitly reports unsupported dynamic Python expressions without executing code', () => {
      const dynamicManifest = `{
    "name": "Dynamic Module",
    "version": os.getenv("MODULE_VERSION", "1.0"),
    "depends": ["base"],
}`;
      const result = extractFromSource('dynamic/__manifest__.py', dynamicManifest);

      // Warning diagnostic for dynamic call
      const dynamicWarning = result.errors.find((e) => e.code === 'unsupported_expression');
      expect(dynamicWarning).toBeDefined();
      expect(dynamicWarning?.message).toContain("Unsupported dynamic Python expression in manifest: 'os'");
      // Base module node still extracted
      expect(result.nodes).toHaveLength(1);
      expect(result.unresolvedReferences.map((r) => r.referenceName)).toContain('base');
    });
  });

  describe('3. Odoo Access Control List CSV Extraction (ir.model.access.csv)', () => {
    it('extracts full ACL permissions, model references, and group references', () => {
      const csvContent = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,purchase.group_purchase_user,1,1,1,0
access_purchase_request_manager,purchase.request manager,model_purchase_request,purchase.group_purchase_manager,1,1,1,1
access_purchase_request_line_user,purchase.request.line user,model_purchase_request_line,purchase.group_purchase_user,1,1,1,0`;

      const result = extractFromSource('purchase_request_fixture/security/ir.model.access.csv', csvContent);

      expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
      expect(result.nodes.filter((n) => n.kind === 'constant')).toHaveLength(3);
      expect(result.nodes.some((n) => n.kind === 'file')).toBe(true);

      // Rule 1: access_purchase_request_user
      const userRule = result.nodes.find((n) => n.name === 'access_purchase_request_user')!;
      expect(userRule).toBeDefined();
      expect(userRule.kind).toBe('constant');
      expect(userRule.signature).toContain('model=purchase.request');
      expect(userRule.signature).toContain('grants=[read:1, write:1, create:1, unlink:0]');
      expect(userRule.docstring).toContain('Grants (Model-Level):');
      expect(userRule.docstring).toContain('Unlink: DENIED (Not granted)');

      // Rule 2: access_purchase_request_manager
      const mgrRule = result.nodes.find((n) => n.name === 'access_purchase_request_manager')!;
      expect(mgrRule).toBeDefined();
      expect(mgrRule.signature).toContain('grants=[read:1, write:1, create:1, unlink:1]');
      expect(mgrRule.docstring).toContain('Unlink: GRANTED');

      // Unresolved references to models and groups
      const modelRefs = result.unresolvedReferences.filter(
        (r) => r.referenceName === 'model_purchase_request' || r.referenceName === 'purchase.request',
      );
      expect(modelRefs.length).toBeGreaterThan(0);

      const groupRefs = result.unresolvedReferences.filter(
        (r) => r.referenceName === 'purchase.group_purchase_user' || r.referenceName === 'purchase.group_purchase_manager',
      );
      expect(groupRefs.length).toBeGreaterThan(0);
    });

    it('distinguishes Global ACL rules (empty group_id) from group-restricted rules', () => {
      const csvContent = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_global_public,public access,model_public_info,,1,0,0,0
access_restricted,restricted access,model_secret,base.group_erp_manager,1,1,1,1`;

      const result = extractFromSource('security/ir.model.access.csv', csvContent);

      expect(result.nodes.filter((n) => n.kind === 'constant')).toHaveLength(2);
      expect(result.nodes.some((n) => n.kind === 'file')).toBe(true);
      const globalNode = result.nodes.find((n) => n.name === 'access_global_public')!;
      expect(globalNode.signature).toContain('group=GLOBAL');
      expect(globalNode.docstring).toContain('GLOBAL (All Users)');

      const restrictedNode = result.nodes.find((n) => n.name === 'access_restricted')!;
      expect(restrictedNode.signature).toContain('group=base.group_erp_manager');
    });

    it('handles malformed CSV and invalid permission values safely', () => {
      const malformedCsv = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_broken,broken rule,model_broken,base.group_user,NOT_A_NUMBER,1,0,0`;

      const result = extractFromSource('security/ir.model.access.csv', malformedCsv);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.code).toBe('invalid_permission_flag');
      // Node is still emitted with fallback 0 (DENIED)
      const brokenNode = result.nodes.find((n) => n.name === 'access_broken')!;
      expect(brokenNode).toBeDefined();
      expect(brokenNode.signature).toContain('read:0');
    });

    it('detects and warns on duplicate ACL rule IDs in the same file', () => {
      const dupCsv = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_rule_dup,rule first,model_purchase_request,purchase.group_purchase_user,1,1,1,0
access_rule_dup,rule second,model_purchase_request,purchase.group_purchase_manager,1,1,1,1`;

      const result = extractFromSource('security/ir.model.access.csv', dupCsv);
      const dupWarning = result.errors.find((e) => e.code === 'duplicate_rule_id');
      expect(dupWarning).toBeDefined();
      expect(dupWarning?.severity).toBe('warning');
      expect(dupWarning?.message).toContain("Duplicate ACL rule id 'access_rule_dup'");
      expect(result.nodes.filter((n) => n.kind === 'constant')).toHaveLength(2);
    });
  });

  describe('4. Odoo Security XML Extraction (security/*.xml)', () => {
    it('extracts ir.rule records, multi-company domains, model/group bindings, and perm flags', () => {
      const xmlContent = `<odoo>
    <record id="purchase_request_company_rule" model="ir.rule">
        <field name="name">Purchase Request multi-company</field>
        <field name="model_id" ref="model_purchase_request"/>
        <field name="domain_force">[('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[(4, ref('purchase.group_purchase_user'))]"/>
    </record>
</odoo>`;

      const result = extractFromSource('purchase_request_fixture/security/purchase_request_security.xml', xmlContent);

      expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
      // File node + RecordRule node
      expect(result.nodes.length).toBe(2);

      const ruleNode = result.nodes.find((n) => n.name === 'purchase_request_company_rule')!;
      expect(ruleNode).toBeDefined();
      expect(ruleNode.kind).toBe('constant');
      expect(ruleNode.signature).toContain('model=purchase.request');
      expect(ruleNode.signature).toContain('Group-Bound (purchase.group_purchase_user)');
      expect(ruleNode.signature).toContain("[('company_id', 'in', company_ids)]");
      expect(ruleNode.docstring).toContain('Purchase Request multi-company');
      expect(ruleNode.docstring).toContain('purchase.group_purchase_user');

      // Unresolved references
      const modelRef = result.unresolvedReferences.find((r) => r.referenceName === 'model_purchase_request');
      expect(modelRef).toBeDefined();
      const groupRef = result.unresolvedReferences.find((r) => r.referenceName === 'purchase.group_purchase_user');
      expect(groupRef).toBeDefined();
    });

    it('identifies Global Record Rules when groups field is omitted', () => {
      const xmlContent = `<odoo>
    <record id="global_product_company_rule" model="ir.rule">
        <field name="name">Global Product multi-company</field>
        <field name="model_id" ref="model_product_template"/>
        <field name="domain_force">['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]</field>
    </record>
</odoo>`;

      const result = extractFromSource('security/product_security.xml', xmlContent);

      const ruleNode = result.nodes.find((n) => n.name === 'global_product_company_rule')!;
      expect(ruleNode).toBeDefined();
      expect(ruleNode.signature).toContain('scope=GLOBAL');
      expect(ruleNode.docstring).toContain('Scope: GLOBAL (All Users');
      expect(ruleNode.docstring).toContain('Groups: ALL');
    });

    it('extracts res.groups records and category/implied inheritance', () => {
      const xmlContent = `<odoo>
    <record id="group_purchase_user" model="res.groups">
        <field name="name">User</field>
        <field name="category_id" ref="base.module_category_purchase_management"/>
        <field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
    </record>
</odoo>`;

      const result = extractFromSource('security/groups.xml', xmlContent);

      const groupNode = result.nodes.find((n) => n.name === 'group_purchase_user')!;
      expect(groupNode).toBeDefined();
      expect(groupNode.signature).toContain('User');
      expect(groupNode.signature).toContain('category=base.module_category_purchase_management');
      expect(groupNode.docstring).toContain('base.group_user');

      const impliedRef = result.unresolvedReferences.find((r) => r.referenceName === 'base.group_user');
      expect(impliedRef).toBeDefined();
    });

    it('enforces anti-XXE security policy and refuses XML external entities and internal subsets', () => {
      const xxeXml = `<?xml version="1.0"?>
<!DOCTYPE test [
  <!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">
]>
<odoo>
    <record id="evil_rule" model="ir.rule">
        <field name="name">&xxe;</field>
    </record>
</odoo>`;

      const result = extractFromSource('security/evil.xml', xxeXml);

      const xxeError = result.errors.find((e) => e.code === 'unsafe_xml_construct');
      expect(xxeError).toBeDefined();
      expect(xxeError?.message).toContain('Security policy violation');
      // No symbol nodes extracted from unsafe XML
      expect(result.nodes.filter((n) => n.kind !== 'file')).toHaveLength(0);

      // Also reject DTD internal subsets without SYSTEM
      const dtdXml = `<!DOCTYPE note [ <!ELEMENT note (to,from,heading,body)> ]><odoo/>`;
      const dtdRes = extractFromSource('security/dtd.xml', dtdXml);
      expect(dtdRes.errors.some((e) => e.code === 'unsafe_xml_construct')).toBe(true);
    });

    it('detects and warns on duplicate record IDs within the same XML file', () => {
      const dupXml = `<odoo>
    <record id="rule_common" model="ir.rule">
        <field name="name">Rule One</field>
        <field name="model_id" ref="model_test"/>
    </record>
    <record id="rule_common" model="ir.rule">
        <field name="name">Rule Two</field>
        <field name="model_id" ref="model_test"/>
    </record>
</odoo>`;
      const result = extractFromSource('security/dup.xml', dupXml);
      const dupWarning = result.errors.find((e) => e.code === 'duplicate_record_id');
      expect(dupWarning).toBeDefined();
      expect(dupWarning?.severity).toBe('warning');
      expect(dupWarning?.message).toContain("Duplicate record definition for id 'rule_common'");
    });

    it('correctly decodes XML entities and maps ir.rule applicability semantics', () => {
      const xmlWithEntities = `<odoo>
    <record id="rule_with_entities" model="ir.rule">
        <field name="name">Tom &amp; Jerry &quot;Special&quot; Rule</field>
        <field name="model_id" ref="model_purchase_order"/>
        <field name="domain_force">[(&apos;state&apos;, &apos;=&apos;, &apos;draft&apos;)]</field>
        <field name="perm_read" eval="1"/>
        <field name="perm_write" eval="0"/>
        <field name="perm_create" eval="0"/>
        <field name="perm_unlink" eval="0"/>
    </record>
</odoo>`;
      const result = extractFromSource('security/entities.xml', xmlWithEntities);
      const rule = result.nodes.find((n) => n.name === 'rule_with_entities')!;
      expect(rule).toBeDefined();
      expect(rule.docstring).toContain("Tom & Jerry \"Special\" Rule");
      expect(rule.signature).toContain("[('state', '=', 'draft')]");
      expect(rule.signature).toContain('restrictions=[read]');
      expect(rule.docstring).toContain('- Read: RESTRICTED by domain filter');
      expect(rule.docstring).toContain('- Write: UNRESTRICTED by this rule');
      expect(rule.docstring).toContain('do not grant baseline model access');
    });
  });

  describe('5. Real Scenario Fixture Verification (B3-ODOO-PR-RFQ-01)', () => {
    const fixtureRoot = 'D:/Project/afyx-alpha/b3.2-installed-runtime-76356555-20261030-r1/scenario-workspace/purchase_request_fixture';

    it('extracts all assets from the frozen B3 fixture deterministically', () => {
      const manifestPath = path.join(fixtureRoot, '__manifest__.py');
      const aclPath = path.join(fixtureRoot, 'security/ir.model.access.csv');
      const secXmlPath = path.join(fixtureRoot, 'security/purchase_request_security.xml');

      if (!fs.existsSync(manifestPath)) {
        // Skip if scenario path is not reachable
        return;
      }

      // Manifest
      const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
      const manifestRes = extractFromSource('purchase_request_fixture/__manifest__.py', manifestSrc);
      expect(manifestRes.nodes).toHaveLength(1);
      expect(manifestRes.nodes[0]!.name).toBe('Synthetic Purchase Request Fixture');
      expect(manifestRes.unresolvedReferences.map((r) => r.referenceName)).toContain('purchase');

      // ACL CSV
      const aclSrc = fs.readFileSync(aclPath, 'utf8');
      const aclRes = extractFromSource('purchase_request_fixture/security/ir.model.access.csv', aclSrc);
      expect(aclRes.nodes.filter((n) => n.kind === 'constant')).toHaveLength(3);
      expect(aclRes.nodes.map((n) => n.name)).toContain('access_purchase_request_user');
      expect(aclRes.nodes.map((n) => n.name)).toContain('access_purchase_request_manager');
      expect(aclRes.nodes.map((n) => n.name)).toContain('access_purchase_request_line_user');

      // Security XML
      const secXmlSrc = fs.readFileSync(secXmlPath, 'utf8');
      const secXmlRes = extractFromSource('purchase_request_fixture/security/purchase_request_security.xml', secXmlSrc);
      const ruleNode = secXmlRes.nodes.find((n) => n.name === 'purchase_request_company_rule');
      expect(ruleNode).toBeDefined();
      expect(ruleNode?.signature).toContain('purchase.group_purchase_user');
      expect(ruleNode?.signature).toContain("[('company_id', 'in', company_ids)]");
    });
  });
});

