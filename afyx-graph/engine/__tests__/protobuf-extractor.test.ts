import { describe, it, expect } from 'vitest';
import { ProtobufExtractor, isProtobufFile } from '../src/extraction/protobuf-extractor';

describe('AFYX-216: Protocol Buffers & gRPC Intelligence Extractor', () => {
  it('identifies .proto files', () => {
    expect(isProtobufFile('user.proto')).toBe(true);
    expect(isProtobufFile('api/v1/service.proto')).toBe(true);
    expect(isProtobufFile('schema.graphql')).toBe(false);
  });

  it('extracts package, services, rpc methods, messages, fields, and enums with type references', () => {
    const protoSource = `
syntax = "proto3";

package acme.user.v1;

import "google/protobuf/timestamp.proto";

enum UserStatus {
  UNKNOWN = 0;
  ACTIVE = 1;
  SUSPENDED = 2;
}

message User {
  int64 id = 1;
  string email = 2;
  UserStatus status = 3;
  google.protobuf.Timestamp created_at = 4;
}

message GetUserRequest {
  int64 id = 1;
}

message GetUserResponse {
  User user = 1;
}

service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
  rpc StreamUsers (GetUserRequest) returns (stream User);
}
`;

    const extractor = new ProtobufExtractor('user.proto', protoSource);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('acme.user.v1');
    expect(names).toContain('UserStatus');
    expect(names).toContain('User');
    expect(names).toContain('GetUserRequest');
    expect(names).toContain('GetUserResponse');
    expect(names).toContain('UserService');
    expect(names).toContain('GetUser');
    expect(names).toContain('StreamUsers');

    // Field names
    expect(names).toContain('email');
    expect(names).toContain('status');

    // Enum values
    expect(names).toContain('ACTIVE');
    expect(names).toContain('SUSPENDED');

    // Import reference
    const importRef = result.unresolvedReferences.find(
      (r) => r.referenceKind === 'imports' && r.referenceName.includes('timestamp.proto')
    );
    expect(importRef).toBeDefined();

    // RPC method references to request/response types
    const reqRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'GetUserRequest'
    );
    expect(reqRef).toBeDefined();

    const respRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'GetUserResponse'
    );
    expect(respRef).toBeDefined();

    // Field reference to enum UserStatus
    const statusFieldRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'UserStatus'
    );
    expect(statusFieldRef).toBeDefined();
  });
});
