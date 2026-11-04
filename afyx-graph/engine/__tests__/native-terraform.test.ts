import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractNativeTerraformFacts } from '../src/extraction/native/terraform-facts';
import { scanSource } from '../src/extraction/native/scanner';
import { tokenizeSource } from '../src/extraction/syntax-tokens';
import { extractFromSource } from '../src/extraction/extract';

const SOURCE = `provider "aws" {
  alias = "east"
}
variable "region" { type = string }
locals { prefix = "prod-\${var.region}" }
data "aws_ami" "ubuntu" { owners = [var.region] }
resource "aws_instance" "web" {
  provider   = aws.east
  ami        = data.aws_ami.ubuntu.id
  depends_on = [aws_iam_role.web]
}
module "network" {
  source = "./modules/network"
  region = var.region
}
output "id" { value = module.network.vpc_id }
`;

function semantic(result: ReturnType<typeof extractFromSource>) {
  const owner = new Map(result.nodes.map((node) => [node.id, `${node.kind}:${node.qualifiedName}`]));
  return {
    nodes: result.nodes.map((node) => ({
      kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
      exported: node.isExported, signature: node.signature,
    })),
    refs: result.unresolvedReferences.map((ref) => ({
      owner: owner.get(ref.fromNodeId), name: ref.referenceName, kind: ref.referenceKind,
    })).sort((left, right) => {
      const a = `${left.owner ?? ''}|${left.kind}|${left.name}`;
      const b = `${right.owner ?? ''}|${right.kind}|${right.name}`;
      return a < b ? -1 : a > b ? 1 : 0;
    }),
  };
}

describe('Afyx-native Terraform and OpenTofu facts', () => {

  afterEach(() => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
  });

  it('preserves the representative parser-backed semantic contract', () => {
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = extractFromSource('main.tf', SOURCE, 'terraform');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = extractFromSource('main.tf', SOURCE, 'terraform');
    expect(semantic(newResult)).toEqual(semantic(oldResult));
  });

  it('routes native-gated Terraform and OpenTofu without requesting a parser', () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    for (const file of ['main.tf', 'variables.tfvars', 'versions.tofu']) {
      const result = extractFromSource(file, file.endsWith('.tfvars') ? 'region = "east"' : SOURCE, 'terraform');
      expect(result.errors.filter((error) => error.severity === 'error')).toHaveLength(0);
    }
  });

  it('classifies Terraform syntax natively without requesting a parser', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = '# note\nvariable "region" { type = string }\nresource "aws_instance" "web" { count = 2 enabled = true values = [for x in var.items : x if x] }';
    const result = await tokenizeSource(source, 'terraform');
    const values = (cls: string) => (result?.spans ?? [])
      .filter((span) => span.cls === cls)
      .map((span) => source.slice(span.start, span.end));
    expect(values('comment')).toContain('# note');
    expect(values('ident')).toEqual(expect.arrayContaining(['variable', 'resource']));
    expect(values('string')).toEqual(expect.arrayContaining(['"region"', '"aws_instance"', '"web"']));
    expect(values('other')).toContain('2');
  });

  it('preserves representative parser-backed syntax classes', async () => {
    const source = '# note\nvariable "region" { type = string }\nresource "aws_instance" "web" { count = 2 }';
    delete process.env.AFYX_GRAPH_NATIVE_PARSER;
    const oldResult = await tokenizeSource(source, 'terraform');
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const newResult = await tokenizeSource(source, 'terraform');
    const classes = (result: Awaited<ReturnType<typeof tokenizeSource>>) =>
      result?.spans.map((span) => [span.cls, source.slice(span.start, span.end)]);
    expect(classes(newResult)).toEqual(classes(oldResult));
  });

  it('keeps heredoc text opaque while extracting static interpolation traversals', () => {
    const source = `variable "region" {}
locals {
  policy = <<-JSON
plain aws_instance.fake.id
region = "\${var.region}"
JSON
}
`;
    const scan = scanSource(source, { hashComments: true, hclSyntax: true });
    expect(scan.unterminated).toHaveLength(0);
    const result = extractNativeTerraformFacts('main.tf', source);
    const refs = result.unresolvedReferences.map((ref) => ref.referenceName);
    expect(refs).toContain('var.region');
    expect(refs).not.toContain('aws_instance.fake');
  });

  it('preserves prefix facts and bounded diagnostics for incomplete buffers', () => {
    const source = 'resource "aws_instance" "web" {\n  user_data = <<EOF\n\${var.region}';
    const result = extractNativeTerraformFacts('main.tf', source);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', qualifiedName: 'aws_instance.web' }),
    ]));
    expect(result.unresolvedReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceName: 'var.region' }),
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'native_incomplete_source' }),
    ]));
  });

  it('keeps dynamic provider and module-source expressions conservative', () => {
    const source = `resource "aws_instance" "web" {
  provider = var.use_east ? aws.east : aws
}
module "network" {
  source = var.module_source
  cidr   = var.cidr
}
module "computed" {
  source = "./modules/\${var.module_name}"
}
`;
    const result = extractNativeTerraformFacts('main.tf', source);
    const refs = result.unresolvedReferences.map((ref) => ref.referenceName);
    expect(refs).not.toContain('provider.aws.east');
    expect(refs).not.toContain('module.network:file');
    expect(refs).not.toContain('module.computed:file');
    expect(refs).toContain('var.cidr');
  });

  it('does not invent callable facts but retains traversals in function arguments', () => {
    const source = 'output "name" { value = lookup(local.names, var.region, "none") }';
    const result = extractNativeTerraformFacts('main.tf', source);
    const refs = result.unresolvedReferences.map((ref) => `${ref.referenceKind}:${ref.referenceName}`);
    expect(refs).toEqual(expect.arrayContaining(['references:local.names', 'references:var.region']));
    expect(refs.some((ref) => ref.startsWith('calls:'))).toBe(false);
  });
});
