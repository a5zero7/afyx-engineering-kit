import { afterEach, describe, expect, it } from 'vitest';
import { extractNativeSolidityFacts } from '../src/extraction/native/solidity-facts';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

afterEach(() => { delete process.env.AFYX_GRAPH_NATIVE_PARSER; });

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import { IERC20 as Token } from "./IERC20.sol";
interface IVault { function deposit(uint256 amount) external returns (bool); }
library Math { function add(uint256 a, uint256 b) internal pure returns (uint256) { return a + b; } }
abstract contract Base { modifier guarded() { _; } }
contract Vault is Base, IVault {
  using Math for uint256;
  struct User { uint256 balance; }
  enum Status { Active, Frozen }
  event Deposited(address indexed account, uint256 amount);
  error Insufficient(uint256 available);
  IERC20 public immutable token;
  mapping(address => User) public users;
  uint256 public constant LIMIT = 100;
  constructor(IERC20 supplied) Base() { token = supplied; }
  function deposit(uint256 amount) external guarded returns (bool) {
    users[msg.sender].balance = users[msg.sender].balance.add(amount);
    emit Deposited(msg.sender, amount);
    if (amount > LIMIT) revert Insufficient(LIMIT);
    return true;
  }
  function create() external returns (Vault) { return new Vault(token); }
  receive() external payable {}
  fallback() external {}
}`;

function refs(result: ReturnType<typeof extractNativeSolidityFacts>, kind: string): string[] {
  return result.unresolvedReferences.filter((ref) => ref.referenceKind === kind).map((ref) => ref.referenceName);
}

describe('Afyx-native Solidity semantic route', () => {
  it('extracts contract-like containers, aggregates, callables, and owned members', () => {
    const result = extractNativeSolidityFacts('Vault.sol', SOURCE);
    const names = result.nodes.map((node) => `${node.kind}:${node.name}`);
    expect(names).toEqual(expect.arrayContaining([
      'import:./IERC20.sol', 'interface:IVault', 'class:Math', 'class:Base', 'class:Vault',
      'struct:User', 'field:balance', 'enum:Status', 'enum_member:Active', 'enum_member:Frozen',
      'field:Deposited', 'field:Insufficient', 'field:token', 'field:users', 'field:LIMIT',
      'method:guarded', 'method:constructor', 'method:deposit', 'method:create',
      'method:receive', 'method:fallback',
    ]));
    expect(result.nodes.find((node) => node.qualifiedName === 'Vault::deposit')?.visibility).toBe('public');
    expect(result.nodes.find((node) => node.qualifiedName === 'Vault::create')?.returnType).toBe('Vault');
  });

  it('preserves inheritance, type, modifier, event/error, call, and instantiation semantics', () => {
    const result = extractNativeSolidityFacts('Vault.sol', SOURCE);
    expect(refs(result, 'extends')).toEqual(expect.arrayContaining(['Base', 'IVault']));
    expect(refs(result, 'references')).toEqual(expect.arrayContaining(['IERC20', 'User', 'Math']));
    expect(refs(result, 'calls')).toEqual(expect.arrayContaining([
      'Base', 'guarded', 'balance.add', 'Deposited', 'Insufficient',
    ]));
    expect(refs(result, 'instantiates')).toContain('Vault');
    const deposit = result.nodes.find((node) => node.qualifiedName === 'Vault::deposit');
    const guarded = result.unresolvedReferences.find((ref) => ref.referenceName === 'guarded' && ref.referenceKind === 'calls');
    expect(guarded?.fromNodeId).toBe(deposit?.id);
  });

  it('routes Solidity facts and syntax classification natively behind the feature gate', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const result = extractFromSource('Vault.sol', SOURCE);
    expect(result.nodes.some((node) => node.kind === 'class' && node.name === 'Vault')).toBe(true);
    const syntax = await tokenizeSource('contract Vault { mapping(address => uint256) balances; }', 'solidity');
    const classified = syntax?.spans.map((span) => [span.cls, 'contract Vault { mapping(address => uint256) balances; }'.slice(span.start, span.end)]);
    expect(classified).toEqual(expect.arrayContaining([
      ['keyword', 'contract'], ['def', 'Vault'], ['keyword', 'mapping'], ['type', 'address'], ['type', 'uint256'],
    ]));
  });

  it('keeps inline assembly bounded and reports malformed input deterministically', () => {
    const complete = extractNativeSolidityFacts('Assembly.sol', 'contract C { function f() external { assembly { let x := 1 } } function g() external {} }');
    expect(complete.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(['C', 'f', 'g']));
    const first = extractNativeSolidityFacts('Broken.sol', 'contract Ready {} contract Broken { function run(');
    const second = extractNativeSolidityFacts('Broken.sol', 'contract Ready {} contract Broken { function run(');
    expect(first.nodes.some((node) => node.name === 'Ready')).toBe(true);
    expect(first.errors.map((error) => error.code)).toEqual(second.errors.map((error) => error.code));
    expect(first.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native_incomplete_source' })]));
  });
});
