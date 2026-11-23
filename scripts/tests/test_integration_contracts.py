#!/usr/bin/env python3
"""Isolated TB3/TB4 provider-neutral contract tests."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "scripts/afyx-integration-contracts.mjs"
REGISTRY = ROOT / "scripts/components.json"


def run_node(source: str) -> dict:
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class IntegrationContractTests(unittest.TestCase):
    def test_executable_contract_versions_match_the_canonical_registry(self) -> None:
        source = f"""
import * as contracts from {json.dumps(CONTRACTS.as_uri())};
console.log(JSON.stringify({{
  provider_capability_contract:contracts.PROVIDER_CAPABILITY_CONTRACT,
  provider_negotiation_contract:contracts.PROVIDER_NEGOTIATION_CONTRACT,
  engineering_task_contract:contracts.ENGINEERING_TASK_CONTRACT,
  engineering_result_contract:contracts.ENGINEERING_RESULT_CONTRACT
}}));
"""
        executable = run_node(source)
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(executable, {key: registry[key] for key in executable})

    def test_task_contract_is_provider_neutral_and_serializes_deterministically(self) -> None:
        source = f"""
import {{createEngineeringTask,validateEngineeringTask,serializeContract}} from {json.dumps(CONTRACTS.as_uri())};
const first=createEngineeringTask({{
  task:{{id:'task-1',operation:'review'}},
  workspace:{{id:'workspace-1',revision:'abc123'}},
  context:{{sources:[{{id:'repo',type:'repository',completeness:'COMPLETE',provenance:{{source:'git',digest:'abc123'}}}}],completeness:'COMPLETE'}},
  requirements:[{{capability:'mcp',required:true,verification:'RUNTIME'}}]
}});
const second=createEngineeringTask({{
  requirements:[{{verification:'RUNTIME',required:true,capability:'mcp'}}],
  context:{{completeness:'COMPLETE',sources:[{{provenance:{{digest:'abc123',source:'git'}},completeness:'COMPLETE',type:'repository',id:'repo'}}]}},
  workspace:{{revision:'abc123',id:'workspace-1'}},
  task:{{operation:'review',id:'task-1'}}
}});
console.log(JSON.stringify({{
  contract:first.contract,
  deterministic:serializeContract(first)===serializeContract(second),
  valid:serializeContract(validateEngineeringTask(first))===serializeContract(first),
  frozen:Object.isFrozen(first)&&Object.isFrozen(first.context.sources[0]),
  integrations:first.integrations
}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["contract"], "AfyxEngineeringTask/v1")
        self.assertTrue(payload["deterministic"])
        self.assertTrue(payload["valid"])
        self.assertTrue(payload["frozen"])
        self.assertEqual(payload["integrations"], [])

    def test_result_evidence_and_optional_graph_context_references_are_explicit(self) -> None:
        source = f"""
import {{createEngineeringResult,serializeContract}} from {json.dumps(CONTRACTS.as_uri())};
const result=createEngineeringResult({{
  taskId:'task-1',status:'SUCCEEDED',output:{{summary:'ok',count:1}},
  evidence:[
    {{id:'graph-check',type:'component-contract',validation:'PASS',provenance:{{source:'afyx-graph',reference:'run:1'}}}},
    {{id:'context-check',type:'component-contract',validation:'NOT_RUN',provenance:{{source:'afyx-context'}}}}
  ],
  diagnostics:[],
  integrations:[
    {{component:'afyx-graph',contract:'afyx.graph.mcp/v1',status:'AVAILABLE',reference:'graph://local'}},
    {{component:'afyx-context',contract:'ace.integration/v1',status:'NOT_RUN'}}
  ]
}});
console.log(JSON.stringify({{result,serialized:serializeContract(result)}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["result"]["contract"], "AfyxEngineeringResult/v1")
        self.assertEqual(
            [item["validation"] for item in payload["result"]["evidence"]],
            ["PASS", "NOT_RUN"],
        )
        self.assertEqual(
            [item["component"] for item in payload["result"]["integrations"]],
            ["afyx-graph", "afyx-context"],
        )
        self.assertIn('"taskId":"task-1"', payload["serialized"])

    def test_malformed_contracts_fail_closed_with_bounded_diagnostics(self) -> None:
        source = f"""
import {{createEngineeringTask,createEngineeringResult,serializeContract}} from {json.dumps(CONTRACTS.as_uri())};
const capture=(fn)=>{{try{{fn();return null;}}catch(error){{return {{code:error.code,path:error.path,message:error.message}};}}}};
const extra=capture(()=>createEngineeringTask({{task:{{id:'x',operation:'review'}},workspace:{{id:'w'}},context:{{sources:[],completeness:'UNKNOWN'}},requirements:[],unexpected:true}}));
const evidence=capture(()=>createEngineeringResult({{taskId:'x',status:'SUCCEEDED',evidence:[{{id:'e',type:'test',validation:'MAYBE',provenance:{{source:'fixture'}}}}],diagnostics:[]}}));
const nonJson=capture(()=>serializeContract({{unsafe:undefined}}));
console.log(JSON.stringify({{extra,evidence,nonJson}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["extra"]["code"], "INVALID_CONTRACT")
        self.assertEqual(payload["extra"]["path"], "taskContract")
        self.assertEqual(payload["evidence"]["code"], "INVALID_CONTRACT")
        self.assertEqual(payload["nonJson"]["code"], "INVALID_CONTRACT")
        self.assertNotIn("undefined", payload["extra"]["message"])

    def test_optional_components_can_degrade_without_becoming_mandatory(self) -> None:
        source = f"""
import {{createEngineeringTask,createEngineeringResult}} from {json.dumps(CONTRACTS.as_uri())};
const task=createEngineeringTask({{
  task:{{id:'task-degraded',operation:'analyze'}},workspace:{{id:'workspace-1'}},
  context:{{sources:[],completeness:'UNKNOWN'}},requirements:[]
}});
const result=createEngineeringResult({{
  taskId:'task-degraded',status:'NOT_RUN',evidence:[],
  diagnostics:[{{code:'OPTIONAL_CONTEXT_UNAVAILABLE',severity:'WARNING',message:'Optional context was unavailable; no execution was attempted.'}}],
  integrations:[{{component:'afyx-context',contract:'ace.integration/v1',status:'UNAVAILABLE'}}]
}});
console.log(JSON.stringify({{task,result}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["task"]["integrations"], [])
        self.assertEqual(payload["result"]["status"], "NOT_RUN")
        self.assertEqual(
            payload["result"]["integrations"][0]["status"], "UNAVAILABLE"
        )

    def test_authorized_and_unauthorized_scope_changes(self) -> None:
        source = f"""
import {{createEngineeringTask,validateTaskScope}} from {json.dumps(CONTRACTS.as_uri())};
const task=createEngineeringTask({{
  task:{{id:'task-scope-1',operation:'apply',objective:'Refactor auth guardrails'}},
  workspace:{{id:'w1',revision:'rev-100'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[],
  policy:{{
    controlMode:'MECHANICAL',
    allowedOperations:['apply','verify'],
    allowedFiles:['scripts/afyx-integration-contracts.mjs','skills/afyx-engineering-expert/**'],
    excludedScope:['evals/forge/vault/**','.env'],
    expectedOutcomes:['Guardrails pass deterministic tests'],
    authorization:'WORKSPACE_WRITE'
  }}
}});

const authorized=validateTaskScope(task,{{
  operation:'apply',
  files:['scripts/afyx-integration-contracts.mjs'],
  revision:'rev-100',
  mutation:true
}});

const badOperation=validateTaskScope(task,{{
  operation:'delete-database',
  files:['scripts/afyx-integration-contracts.mjs'],
  revision:'rev-100',
  mutation:true
}});

const badFile=validateTaskScope(task,{{
  operation:'apply',
  files:['src/unrelated.js'],
  revision:'rev-100',
  mutation:true
}});

const excludedFile=validateTaskScope(task,{{
  operation:'apply',
  files:['evals/forge/vault/secret.json'],
  revision:'rev-100',
  mutation:true
}});

const readOnlyTask=createEngineeringTask({{
  task:{{id:'task-ro',operation:'review'}},
  workspace:{{id:'w1',revision:'rev-100'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[],
  policy:{{
    allowedOperations:['review','inspect'],
    allowedFiles:['**'],
    authorization:'READ_ONLY'
  }}
}});

const unauthorizedMutation=validateTaskScope(readOnlyTask,{{
  operation:'apply',
  files:['scripts/test.js'],
  revision:'rev-100',
  mutation:true
}});

const windowsPathAuthorized=validateTaskScope(task,{{
  operation:'apply',
  files:['scripts\\\\afyx-integration-contracts.mjs'],
  revision:'rev-100',
  mutation:true
}});

const traversalEscaping=validateTaskScope(task,{{
  operation:'apply',
  files:['../outside.txt'],
  revision:'rev-100',
  mutation:true
}});

const traversalDisguised=validateTaskScope(task,{{
  operation:'apply',
  files:['scripts/../evals/forge/vault/secret.json'],
  revision:'rev-100',
  mutation:true
}});

console.log(JSON.stringify({{authorized,badOperation,badFile,excludedFile,unauthorizedMutation,windowsPathAuthorized,traversalEscaping,traversalDisguised}}));
"""
        payload = run_node(source)
        self.assertTrue(payload["authorized"]["allowed"])
        self.assertEqual(payload["authorized"]["status"], "SCOPE_AUTHORIZED")

        self.assertFalse(payload["badOperation"]["allowed"])
        self.assertEqual(
            payload["badOperation"]["violations"][0]["code"], "UNAUTHORIZED_OPERATION"
        )

        self.assertFalse(payload["badFile"]["allowed"])
        self.assertEqual(
            payload["badFile"]["violations"][0]["code"], "UNAUTHORIZED_FILE_SCOPE"
        )

        self.assertFalse(payload["excludedFile"]["allowed"])
        self.assertEqual(
            payload["excludedFile"]["violations"][0]["code"], "EXCLUDED_SCOPE_VIOLATION"
        )

        self.assertFalse(payload["unauthorizedMutation"]["allowed"])
        codes = [v["code"] for v in payload["unauthorizedMutation"]["violations"]]
        self.assertIn("MUTATION_NOT_AUTHORIZED", codes)

        self.assertTrue(payload["windowsPathAuthorized"]["allowed"])
        self.assertEqual(payload["windowsPathAuthorized"]["status"], "SCOPE_AUTHORIZED")

        self.assertFalse(payload["traversalEscaping"]["allowed"])
        traversal_codes = [v["code"] for v in payload["traversalEscaping"]["violations"]]
        self.assertIn("PATH_TRAVERSAL_DETECTED", traversal_codes)

        self.assertFalse(payload["traversalDisguised"]["allowed"])
        disguised_codes = [v["code"] for v in payload["traversalDisguised"]["violations"]]
        self.assertIn("EXCLUDED_SCOPE_VIOLATION", disguised_codes)

    def test_scope_validator_rejects_unsafe_absolute_paths(self) -> None:
        source = f"""
import {{createEngineeringTask,validateTaskScope}} from {json.dumps(CONTRACTS.as_uri())};
const task=createEngineeringTask({{
  task:{{id:'task-abs',operation:'apply'}},
  workspace:{{id:'w-abs',revision:'rev-1'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[],
  policy:{{
    allowedOperations:['apply'],
    allowedFiles:['**'],
    authorization:'WORKSPACE_WRITE'
  }}
}});

const winDrive=validateTaskScope(task,{{
  operation:'apply',
  files:['C:\\\\Windows\\\\System32\\\\calc.exe'],
  revision:'rev-1',
  mutation:true
}});

const winDriveRelative=validateTaskScope(task,{{
  operation:'apply',
  files:['C:temp\\\\file.txt'],
  revision:'rev-1',
  mutation:true
}});

const winUNC=validateTaskScope(task,{{
  operation:'apply',
  files:['\\\\\\\\server\\\\share\\\\file.txt'],
  revision:'rev-1',
  mutation:true
}});

const forwardUNC=validateTaskScope(task,{{
  operation:'apply',
  files:['//server/share/file.txt'],
  revision:'rev-1',
  mutation:true
}});

const posixRoot=validateTaskScope(task,{{
  operation:'apply',
  files:['/etc/passwd'],
  revision:'rev-1',
  mutation:true
}});

const winRootRelative=validateTaskScope(task,{{
  operation:'apply',
  files:['\\\\Windows\\\\notepad.exe'],
  revision:'rev-1',
  mutation:true
}});

const validRelativeWin=validateTaskScope(task,{{
  operation:'apply',
  files:['scripts\\\\afyx-integration-contracts.mjs'],
  revision:'rev-1',
  mutation:true
}});

console.log(JSON.stringify({{
  winDrive,
  winDriveRelative,
  winUNC,
  forwardUNC,
  posixRoot,
  winRootRelative,
  validRelativeWin
}}));
"""
        payload = run_node(source)
        self.assertFalse(payload["winDrive"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["winDrive"]["violations"]])

        self.assertFalse(payload["winDriveRelative"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["winDriveRelative"]["violations"]])

        self.assertFalse(payload["winUNC"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["winUNC"]["violations"]])

        self.assertFalse(payload["forwardUNC"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["forwardUNC"]["violations"]])

        self.assertFalse(payload["posixRoot"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["posixRoot"]["violations"]])

        self.assertFalse(payload["winRootRelative"]["allowed"])
        self.assertIn("ABSOLUTE_PATH_REJECTED", [v["code"] for v in payload["winRootRelative"]["violations"]])

        self.assertEqual(payload["winDrive"]["status"], "SCOPE_VIOLATION")

        self.assertTrue(payload["validRelativeWin"]["allowed"])
        self.assertEqual(payload["validRelativeWin"]["status"], "SCOPE_AUTHORIZED")

    def test_scope_validator_fails_closed_on_missing_mutation_context(self) -> None:
        source = f"""
import {{createEngineeringTask,validateTaskScope}} from {json.dumps(CONTRACTS.as_uri())};
const guardedTask=createEngineeringTask({{
  task:{{id:'task-guarded',operation:'apply'}},
  workspace:{{id:'w-guarded',revision:'rev-abc'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[],
  policy:{{
    allowedOperations:['apply','verify'],
    allowedFiles:['scripts/**'],
    authorization:'WORKSPACE_WRITE'
  }}
}});

const missingRevision=validateTaskScope(guardedTask,{{
  operation:'apply',
  files:['scripts/test.js'],
  mutation:true
}});

const missingOperation=validateTaskScope(guardedTask,{{
  files:['scripts/test.js'],
  revision:'rev-abc',
  mutation:true
}});

const missingFiles=validateTaskScope(guardedTask,{{
  operation:'apply',
  revision:'rev-abc',
  mutation:true
}});

const emptyFiles=validateTaskScope(guardedTask,{{
  operation:'apply',
  files:[],
  revision:'rev-abc',
  mutation:true
}});

const legacyTask=createEngineeringTask({{
  task:{{id:'task-legacy',operation:'apply'}},
  workspace:{{id:'w-legacy'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[]
}});

const legacyAction=validateTaskScope(legacyTask,{{
  operation:'apply',
  files:['scripts/any.js']
}});

console.log(JSON.stringify({{
  missingRevision,
  missingOperation,
  missingFiles,
  emptyFiles,
  legacyAction
}}));
"""
        payload = run_node(source)
        self.assertFalse(payload["missingRevision"]["allowed"])
        self.assertIn("MISSING_SOURCE_REVISION", [v["code"] for v in payload["missingRevision"]["violations"]])

        self.assertFalse(payload["missingOperation"]["allowed"])
        self.assertIn("MISSING_OPERATION", [v["code"] for v in payload["missingOperation"]["violations"]])

        self.assertFalse(payload["missingFiles"]["allowed"])
        self.assertIn("MISSING_TARGET_FILES", [v["code"] for v in payload["missingFiles"]["violations"]])

        self.assertFalse(payload["emptyFiles"]["allowed"])
        self.assertIn("MISSING_TARGET_FILES", [v["code"] for v in payload["emptyFiles"]["violations"]])

        self.assertTrue(payload["legacyAction"]["allowed"])
        self.assertEqual(payload["legacyAction"]["status"], "SCOPE_AUTHORIZED")
        self.assertEqual(payload["legacyAction"]["violations"], [])

    def test_unsupported_claim_rejection(self) -> None:
        source = f"""
import {{createEngineeringResult}} from {json.dumps(CONTRACTS.as_uri())};
const capture=(fn)=>{{try{{fn();return null;}}catch(error){{return {{code:error.code,path:error.path,message:error.message}};}}}};

const inferencePass=capture(()=>createEngineeringResult({{
  taskId:'task-claims',status:'SUCCEEDED',diagnostics:[],
  evidence:[{{id:'e1',type:'assertion',validation:'PASS',evidenceClass:'INFERENCE',provenance:{{source:'agent-assumption'}}}}]
}}));

const unavailablePass=capture(()=>createEngineeringResult({{
  taskId:'task-claims',status:'SUCCEEDED',diagnostics:[],
  evidence:[{{id:'e2',type:'check',validation:'PASS',evidenceClass:'UNAVAILABLE',provenance:{{source:'unreachable-host'}}}}]
}}));

const mockClaimedDirectPass=capture(()=>createEngineeringResult({{
  taskId:'task-claims',status:'SUCCEEDED',diagnostics:[],
  evidence:[{{id:'e3',type:'test',validation:'PASS',evidenceClass:'DIRECT_EXECUTION',executionType:'MOCK',provenance:{{source:'mock-runner'}}}}]
}}));

const validDirectPass=createEngineeringResult({{
  taskId:'task-claims',status:'SUCCEEDED',diagnostics:[],
  evidence:[{{id:'e4',type:'test',validation:'PASS',evidenceClass:'DIRECT_EXECUTION',executionType:'REAL',provenance:{{source:'pytest'}}}}]
}});

const validUnavailableSkip=createEngineeringResult({{
  taskId:'task-claims',status:'BLOCKED',diagnostics:[],
  evidence:[{{id:'e5',type:'integration',validation:'NOT_RUN',evidenceClass:'UNAVAILABLE',provenance:{{source:'vault'}}}}]
}});

console.log(JSON.stringify({{inferencePass,unavailablePass,mockClaimedDirectPass,validDirectPassValid:validDirectPass.evidence[0].validation,validUnavailableSkipValid:validUnavailableSkip.evidence[0].validation}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["inferencePass"]["code"], "INVALID_CONTRACT")
        self.assertIn("unsupported claim cannot receive verified PASS status", payload["inferencePass"]["message"])

        self.assertEqual(payload["unavailablePass"]["code"], "INVALID_CONTRACT")
        self.assertIn("unsupported claim cannot receive verified PASS status", payload["unavailablePass"]["message"])

        self.assertEqual(payload["mockClaimedDirectPass"]["code"], "INVALID_CONTRACT")
        self.assertIn("mock execution cannot receive verified direct execution PASS status", payload["mockClaimedDirectPass"]["message"])

        self.assertEqual(payload["validDirectPassValid"], "PASS")
        self.assertEqual(payload["validUnavailableSkipValid"], "NOT_RUN")

    def test_source_revision_mismatch(self) -> None:
        source = f"""
import {{createEngineeringTask,validateTaskScope}} from {json.dumps(CONTRACTS.as_uri())};
const task=createEngineeringTask({{
  task:{{id:'task-rev',operation:'apply'}},
  workspace:{{id:'w-rev',revision:'commit-sha-474c0f5'}},
  context:{{sources:[],completeness:'COMPLETE'}},
  requirements:[],
  policy:{{allowedOperations:['apply'],allowedFiles:['src/**'],authorization:'WORKSPACE_WRITE'}}
}});

const mismatch=validateTaskScope(task,{{
  operation:'apply',
  files:['src/file.js'],
  revision:'commit-sha-89dfd58',
  mutation:true
}});

const match=validateTaskScope(task,{{
  operation:'apply',
  files:['src/file.js'],
  revision:'commit-sha-474c0f5',
  mutation:true
}});

console.log(JSON.stringify({{mismatch,match}}));
"""
        payload = run_node(source)
        self.assertFalse(payload["mismatch"]["allowed"])
        self.assertEqual(payload["mismatch"]["violations"][0]["code"], "SOURCE_REVISION_MISMATCH")
        self.assertTrue(payload["match"]["allowed"])

    def test_accurate_execution_and_skip_classification(self) -> None:
        source = f"""
import {{createEngineeringResult}} from {json.dumps(CONTRACTS.as_uri())};
const result=createEngineeringResult({{
  taskId:'task-classification',status:'SUCCEEDED',output:{{}},diagnostics:[],
  evidence:[
    {{id:'real-test',type:'unit-test',validation:'PASS',evidenceClass:'DIRECT_EXECUTION',executionType:'REAL',provenance:{{source:'unittest'}}}},
    {{id:'static-audit',type:'static-check',validation:'PASS',evidenceClass:'VERIFIED_SOURCE',executionType:'STATIC',provenance:{{source:'linter'}}}},
    {{id:'skipped-integration',type:'integration',validation:'NOT_RUN',evidenceClass:'UNAVAILABLE',executionType:'NONE',provenance:{{source:'optional-service'}}}},
    {{id:'blocked-e2e',type:'e2e',validation:'BLOCKED',evidenceClass:'UNAVAILABLE',executionType:'NONE',provenance:{{source:'credential-missing'}}}}
  ]
}});
console.log(JSON.stringify({{
  evidence:result.evidence.map(e=>({{id:e.id,validation:e.validation,evidenceClass:e.evidenceClass,executionType:e.executionType}}))
}}));
"""
        payload = run_node(source)
        items = {e["id"]: e for e in payload["evidence"]}
        self.assertEqual(items["real-test"]["validation"], "PASS")
        self.assertEqual(items["real-test"]["evidenceClass"], "DIRECT_EXECUTION")
        self.assertEqual(items["real-test"]["executionType"], "REAL")

        self.assertEqual(items["static-audit"]["validation"], "PASS")
        self.assertEqual(items["static-audit"]["evidenceClass"], "VERIFIED_SOURCE")
        self.assertEqual(items["static-audit"]["executionType"], "STATIC")

        self.assertEqual(items["skipped-integration"]["validation"], "NOT_RUN")
        self.assertEqual(items["skipped-integration"]["executionType"], "NONE")

        self.assertEqual(items["blocked-e2e"]["validation"], "BLOCKED")

    def test_graph_freshness_and_justified_fallback(self) -> None:
        source = f"""
import {{evaluateSearchEfficiency}} from {json.dumps(CONTRACTS.as_uri())};
const directInspection=evaluateSearchEfficiency({{
  query:'find auth helper',
  knownPath:'scripts/afyx-integration-contracts.mjs',
  requiresRelationships:false
}});

const freshGraph=evaluateSearchEfficiency({{
  query:'explore caller hierarchy of createEngineeringTask',
  requiresRelationships:true,
  indexFreshness:'FRESH'
}});

const staleGraph=evaluateSearchEfficiency({{
  query:'explore caller hierarchy of createEngineeringTask',
  requiresRelationships:true,
  indexFreshness:'STALE'
}});

console.log(JSON.stringify({{directInspection,freshGraph,staleGraph}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["directInspection"]["action"], "DIRECT_INSPECTION")
        self.assertEqual(payload["directInspection"]["target"], "scripts/afyx-integration-contracts.mjs")

        self.assertEqual(payload["freshGraph"]["action"], "GRAPH_EXPLORE")
        self.assertEqual(payload["freshGraph"]["reason"], "RELATIONSHIP_ANALYSIS_REQUIRED")

        self.assertEqual(payload["staleGraph"]["action"], "GRAPH_EXPLORE")
        self.assertEqual(payload["staleGraph"]["reason"], "STALE_INDEX_FALLBACK_RECOMMENDED")

    def test_duplicate_search_reuse_and_justified_requery(self) -> None:
        source = f"""
import {{evaluateSearchEfficiency}} from {json.dumps(CONTRACTS.as_uri())};
const previous=['find authentication tokens in scripts'];

const duplicate=evaluateSearchEfficiency({{
  query:'find authentication tokens in scripts',
  previousQueries:previous,
  newEvidenceAvailable:false,
  indexFreshness:'FRESH'
}});

const requeryEvidence=evaluateSearchEfficiency({{
  query:'find authentication tokens in scripts',
  previousQueries:previous,
  newEvidenceAvailable:true,
  indexFreshness:'FRESH'
}});

const requeryStaleness=evaluateSearchEfficiency({{
  query:'find authentication tokens in scripts',
  previousQueries:previous,
  newEvidenceAvailable:false,
  indexFreshness:'STALE'
}});

const requeryUnresolved=evaluateSearchEfficiency({{
  query:'find authentication tokens in scripts',
  previousQueries:previous,
  newEvidenceAvailable:false,
  indexFreshness:'FRESH',
  unresolvedQuestion:'Does Antigravity provider implement hooks?'
}});

console.log(JSON.stringify({{duplicate,requeryEvidence,requeryStaleness,requeryUnresolved}}));
"""
        payload = run_node(source)
        self.assertEqual(payload["duplicate"]["action"], "REUSE_PREVIOUS")
        self.assertEqual(payload["duplicate"]["reason"], "DUPLICATE_QUERY_REUSE")

        self.assertEqual(payload["requeryEvidence"]["action"], "EXECUTE")
        self.assertEqual(payload["requeryEvidence"]["reason"], "REQUERY_JUSTIFIED_BY_NEW_EVIDENCE")

        self.assertEqual(payload["requeryStaleness"]["action"], "EXECUTE")
        self.assertEqual(payload["requeryStaleness"]["reason"], "REQUERY_JUSTIFIED_BY_INDEX_STALENESS")

        self.assertEqual(payload["requeryUnresolved"]["action"], "EXECUTE")
        self.assertEqual(payload["requeryUnresolved"]["reason"], "REQUERY_JUSTIFIED_BY_UNRESOLVED_QUESTION")

    def test_provider_capability_absence_and_control_separation(self) -> None:
        source = f"""
import {{discoverProviderCapabilities,negotiateProviderCapabilities,evaluateProviderGuardrailsPolicy}} from {json.dumps(CONTRACTS.as_uri())};
const antigravityDef={{
  provider:'antigravity',name:'Antigravity',ownership_class:'USER',
  configuration_policy:'merge-afyx-owned-entries-only',
  host_commands:'agy;antigravity',surfaces:'cli;ide',
  capabilities:'skills;mcp',skill_scopes:'ide-global;cli-global;workspace',mcp_scopes:'global;workspace'
}};

const discovery=discoverProviderCapabilities(antigravityDef,{{scopes:['global']}});
const negotiation=negotiateProviderCapabilities(discovery,[
  {{capability:'skills',required:true,verification:'DECLARED'}},
  {{capability:'hooks',required:false,verification:'DECLARED'}},
  {{capability:'provider-routing',required:false,verification:'DECLARED'}}
]);

const policy=evaluateProviderGuardrailsPolicy('antigravity',negotiation);
console.log(JSON.stringify({{negotiation,policy}}));
"""
        payload = run_node(source)
        reqs = {r["capability"]: r for r in payload["negotiation"]["requirements"]}
        self.assertEqual(reqs["skills"]["status"], "SUPPORTED")
        self.assertEqual(reqs["hooks"]["status"], "UNSUPPORTED")
        self.assertEqual(reqs["provider-routing"]["status"], "UNSUPPORTED")

        policy = payload["policy"]
        self.assertEqual(policy["contract"], "AfyxAgentGuardrails/v1")
        self.assertEqual(policy["enforcementScope"], "VALIDATOR_ONLY")
        self.assertTrue(policy["contractValidatorsAvailable"])
        self.assertTrue(policy["explicitInvocationValidation"])
        self.assertFalse(policy["automaticMutationInterception"])
        self.assertFalse(policy["automaticGraphInterception"])
        self.assertFalse(policy["runtimeEnforcementActive"])
        self.assertFalse(policy["osLevelEnforcement"])
        self.assertFalse(policy["mechanicalEnforcement"])
        self.assertIn("hooks", policy["unsupportedCapabilities"])
        self.assertIn("provider-routing", policy["unsupportedCapabilities"])
        self.assertTrue(policy["gracefullyDegraded"])

    def test_backward_compatibility_of_existing_contracts(self) -> None:
        source = f"""
import {{createEngineeringTask,validateEngineeringTask,createEngineeringResult,validateEngineeringResult,serializeContract}} from {json.dumps(CONTRACTS.as_uri())};
const legacyTask=createEngineeringTask({{
  task:{{id:'legacy-task-1',operation:'inspect'}},
  workspace:{{id:'w-legacy'}},
  context:{{sources:[],completeness:'UNKNOWN'}},
  requirements:[]
}});

const legacyResult=createEngineeringResult({{
  taskId:'legacy-task-1',status:'SUCCEEDED',diagnostics:[],
  evidence:[{{id:'legacy-e1',type:'test',validation:'PASS',provenance:{{source:'legacy-tool'}}}}]
}});

console.log(JSON.stringify({{
  taskValid:serializeContract(validateEngineeringTask(legacyTask))===serializeContract(legacyTask),
  resultValid:serializeContract(validateEngineeringResult(legacyResult))===serializeContract(legacyResult),
  taskHasPolicy:'policy' in legacyTask,
  evidenceHasClass:'evidenceClass' in legacyResult.evidence[0]
}}));
"""
        payload = run_node(source)
        self.assertTrue(payload["taskValid"])
        self.assertTrue(payload["resultValid"])
        self.assertFalse(payload["taskHasPolicy"])
        self.assertFalse(payload["evidenceHasClass"])

    def test_scope_validator_mutation_classification_and_context_closure(self) -> None:
        source = f"""
import {{createEngineeringTask,validateTaskScope}} from {json.dumps(CONTRACTS.as_uri())};

// 1. READ_ONLY task
const readOnlyTask = createEngineeringTask({{
  task: {{id: 'ro-1', operation: 'review'}},
  workspace: {{id: 'w-ro', revision: 'rev-ro'}},
  context: {{sources: [], completeness: 'COMPLETE'}},
  requirements: [],
  policy: {{
    allowedOperations: ['review', 'inspect'],
    allowedFiles: ['**'],
    authorization: 'READ_ONLY'
  }}
}});

// 1a. READ_ONLY + apply + files + mutation:false -> REJECT (MUTATION_NOT_AUTHORIZED)
const readOnlyApplyBypass = validateTaskScope(readOnlyTask, {{
  operation: 'apply',
  files: ['scripts/test.js'],
  revision: 'rev-ro',
  mutation: false
}});

// 1b. Valid inspect/review on READ_ONLY -> PASS
const readOnlyInspect = validateTaskScope(readOnlyTask, {{
  operation: 'inspect',
  files: ['scripts/test.js'],
  mutation: false
}});

const readOnlyReview = validateTaskScope(readOnlyTask, {{
  operation: 'review',
  files: ['scripts/test.js']
}});

// 2. Guarded write task
const guardedWriteTask = createEngineeringTask({{
  task: {{id: 'gw-1', operation: 'apply'}},
  workspace: {{id: 'w-gw', revision: 'rev-gw'}},
  context: {{sources: [], completeness: 'COMPLETE'}},
  requirements: [],
  policy: {{
    allowedOperations: ['apply', 'verify'],
    allowedFiles: ['scripts/**'],
    authorization: 'WORKSPACE_WRITE'
  }}
}});

// 2a. Guarded apply + missing revision + mutation:false -> REJECT (MISSING_SOURCE_REVISION)
const guardedMissingRevBypass = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: ['scripts/test.js'],
  mutation: false
}});

// 2b. Guarded mutating operation without target files -> REJECT (MISSING_TARGET_FILES)
const guardedApplyNoFiles = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  revision: 'rev-gw',
  mutation: false
}});

const guardedApplyEmptyFiles = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: [],
  revision: 'rev-gw'
}});

// 2c. Valid authorized mutation -> PASS
const validMutation = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: ['scripts/test.js'],
  revision: 'rev-gw',
  mutation: true
}});

// 3. Malformed mutation context or file entries -> REJECT
const malformedMutationType = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: ['scripts/test.js'],
  revision: 'rev-gw',
  mutation: 'false'
}});

const malformedFilesType = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: 'scripts/test.js',
  revision: 'rev-gw',
  mutation: true
}});

const invalidFileEntryNull = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: [null],
  revision: 'rev-gw',
  mutation: true
}});

const invalidFileEntryEmpty = validateTaskScope(guardedWriteTask, {{
  operation: 'apply',
  files: ['scripts/test.js', ''],
  revision: 'rev-gw',
  mutation: true
}});

const malformedOperationType = validateTaskScope(guardedWriteTask, {{
  operation: 12345,
  files: ['scripts/test.js'],
  revision: 'rev-gw'
}});

// 4. Guarded write policy without allowlists -> REJECT (does not silently allow unrestricted access)
const unconfiguredWriteTask = createEngineeringTask({{
  task: {{id: 'unconf-1', operation: 'apply'}},
  workspace: {{id: 'w-unconf', revision: 'rev-unconf'}},
  context: {{sources: [], completeness: 'COMPLETE'}},
  requirements: [],
  policy: {{
    authorization: 'WORKSPACE_WRITE'
  }}
}});

const unconfiguredWriteAction = validateTaskScope(unconfiguredWriteTask, {{
  operation: 'apply',
  files: ['scripts/test.js'],
  revision: 'rev-unconf',
  mutation: true
}});

// 5. Legacy task compatibility -> PASS
const legacyTask = createEngineeringTask({{
  task: {{id: 'leg-1', operation: 'apply'}},
  workspace: {{id: 'w-leg'}},
  context: {{sources: [], completeness: 'COMPLETE'}},
  requirements: []
}});

const legacyAction = validateTaskScope(legacyTask, {{
  operation: 'apply',
  files: ['scripts/test.js']
}});

console.log(JSON.stringify({{
  readOnlyApplyBypass,
  readOnlyInspect,
  readOnlyReview,
  guardedMissingRevBypass,
  guardedApplyNoFiles,
  guardedApplyEmptyFiles,
  validMutation,
  malformedMutationType,
  malformedFilesType,
  invalidFileEntryNull,
  invalidFileEntryEmpty,
  malformedOperationType,
  unconfiguredWriteAction,
  legacyAction
}}));
"""
        payload = run_node(source)

        # 1a. READ_ONLY + apply + files + mutation:false -> REJECT (MUTATION_NOT_AUTHORIZED)
        self.assertFalse(payload["readOnlyApplyBypass"]["allowed"])
        ro_codes = [v["code"] for v in payload["readOnlyApplyBypass"]["violations"]]
        self.assertIn("MUTATION_NOT_AUTHORIZED", ro_codes)

        # 1b. Valid inspect/review on READ_ONLY -> PASS
        self.assertTrue(payload["readOnlyInspect"]["allowed"])
        self.assertEqual(payload["readOnlyInspect"]["status"], "SCOPE_AUTHORIZED")
        self.assertTrue(payload["readOnlyReview"]["allowed"])
        self.assertEqual(payload["readOnlyReview"]["status"], "SCOPE_AUTHORIZED")

        # 2a. Guarded apply + missing revision + mutation:false -> REJECT (MISSING_SOURCE_REVISION)
        self.assertFalse(payload["guardedMissingRevBypass"]["allowed"])
        rev_codes = [v["code"] for v in payload["guardedMissingRevBypass"]["violations"]]
        self.assertIn("MISSING_SOURCE_REVISION", rev_codes)

        # 2b. Guarded mutating operation without target files -> REJECT (MISSING_TARGET_FILES)
        self.assertFalse(payload["guardedApplyNoFiles"]["allowed"])
        no_files_codes = [v["code"] for v in payload["guardedApplyNoFiles"]["violations"]]
        self.assertIn("MISSING_TARGET_FILES", no_files_codes)

        self.assertFalse(payload["guardedApplyEmptyFiles"]["allowed"])
        empty_files_codes = [v["code"] for v in payload["guardedApplyEmptyFiles"]["violations"]]
        self.assertIn("MISSING_TARGET_FILES", empty_files_codes)

        # 2c. Valid authorized mutation -> PASS
        self.assertTrue(payload["validMutation"]["allowed"])
        self.assertEqual(payload["validMutation"]["status"], "SCOPE_AUTHORIZED")

        # 3. Malformed mutation context or file entries -> REJECT
        self.assertFalse(payload["malformedMutationType"]["allowed"])
        self.assertIn("MALFORMED_ACTION_FIELD", [v["code"] for v in payload["malformedMutationType"]["violations"]])

        self.assertFalse(payload["malformedFilesType"]["allowed"])
        self.assertIn("MALFORMED_ACTION_FIELD", [v["code"] for v in payload["malformedFilesType"]["violations"]])

        self.assertFalse(payload["invalidFileEntryNull"]["allowed"])
        self.assertIn("INVALID_FILE_ENTRY", [v["code"] for v in payload["invalidFileEntryNull"]["violations"]])

        self.assertFalse(payload["invalidFileEntryEmpty"]["allowed"])
        self.assertIn("INVALID_FILE_ENTRY", [v["code"] for v in payload["invalidFileEntryEmpty"]["violations"]])

        self.assertFalse(payload["malformedOperationType"]["allowed"])
        self.assertIn("MALFORMED_ACTION_FIELD", [v["code"] for v in payload["malformedOperationType"]["violations"]])

        # 4. Guarded write policy without allowlists -> REJECT
        self.assertFalse(payload["unconfiguredWriteAction"]["allowed"])
        unconf_codes = [v["code"] for v in payload["unconfiguredWriteAction"]["violations"]]
        self.assertIn("UNAUTHORIZED_OPERATION", unconf_codes)
        self.assertIn("UNAUTHORIZED_FILE_SCOPE", unconf_codes)

        # 5. Legacy task compatibility -> PASS
        self.assertTrue(payload["legacyAction"]["allowed"])
        self.assertEqual(payload["legacyAction"]["status"], "SCOPE_AUTHORIZED")
        self.assertEqual(payload["legacyAction"]["violations"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
