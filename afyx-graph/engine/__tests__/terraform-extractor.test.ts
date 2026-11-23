import { describe, it, expect } from 'vitest';
import { TerraformExtractor, isTerraformFile } from '../src/extraction/terraform-extractor';

describe('AFYX-210: Terraform & OpenTofu Intelligence Extractor', () => {
  it('identifies .tf, .tofu, and .tfvars files', () => {
    expect(isTerraformFile('main.tf')).toBe(true);
    expect(isTerraformFile('infra/network.tofu')).toBe(true);
    expect(isTerraformFile('terraform.tfvars')).toBe(true);
    expect(isTerraformFile('main.py')).toBe(false);
  });

  it('extracts resources, data sources, modules, outputs, depends_on, and masks secrets', () => {
    const tfSource = `
terraform {
  required_version = ">= 1.5.0"
}

provider "aws" {
  region = "us-west-2"
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "supersecretpassword123"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
  depends_on = [aws_vpc.main]
}

module "app_cluster" {
  source     = "./modules/cluster"
  vpc_id     = aws_vpc.main.id
  depends_on = [aws_subnet.public]
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "db_secret" {
  value     = var.db_password
  sensitive = true
}
`;

    const extractor = new TerraformExtractor('main.tf', tfSource);
    const result = extractor.extract();

    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('aws');
    expect(names).toContain('aws_vpc.main');
    expect(names).toContain('aws_subnet.public');
    expect(names).toContain('app_cluster');
    expect(names).toContain('vpc_id');
    expect(names).toContain('db_secret');

    // depends_on reference verification
    const subnetDependsOnVpc = result.unresolvedReferences.find(
      (r) => r.referenceName === 'aws_vpc.main'
    );
    expect(subnetDependsOnVpc).toBeDefined();

    const clusterDependsOnSubnet = result.unresolvedReferences.find(
      (r) => r.referenceName === 'aws_subnet.public'
    );
    expect(clusterDependsOnSubnet).toBeDefined();

    // Secret safety: variable signature and output signature never leak default passwords
    const varNode = result.nodes.find((n) => n.name === 'db_password');
    expect(varNode).toBeDefined();
    expect(varNode?.signature).not.toContain('supersecretpassword123');

    const outSecretNode = result.nodes.find((n) => n.name === 'db_secret');
    expect(outSecretNode).toBeDefined();
    expect(outSecretNode?.signature).not.toContain('supersecretpassword123');
  });
});
