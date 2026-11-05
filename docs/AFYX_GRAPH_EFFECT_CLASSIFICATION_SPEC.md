# AFYX Graph Effect Classification Specification

Status: implementation contract for AFYX-320.

## Purpose

The classifier reports a call as an external effect only when its source text,
language family, receiver identity, operation, and optional declared receiver
type provide enough evidence. Unknown and ambiguous calls return no effect.

## Inputs and normalization

- Input is the call text as written, its call/constructor kind, language,
  project kind, optional receiver type, and argument text.
- Syntactic wrappers such as `await`, `new`, optional chaining, generic type
  arguments, and balanced call arguments do not change identity.
- Classification uses tokens (receiver, member path, operation), not a regex
  catalogue copied from another implementation.

## Authority rules

1. Standard runtime namespaces and standard exception types are exclusions.
2. Language-specific receivers and operations take precedence over generic
   conventions.
3. Database classification requires both a store-shaped receiver/type and a
   recognized read/write operation. A bare method name is insufficient.
4. Response constructors are effects only for API/web projects. Ordinary
   application exceptions are not HTTP responses.
5. Crypto is authentication only for credential/token/MAC operations; generic
   hashing and randomness are not classified as authentication.
6. Unknown languages receive only intentionally universal rules.
7. When evidence is insufficient, the result is `null`; the classifier never
   manufactures a category.

## Output contract

The result contains a category. Database results may additionally contain a
source-grounded model and read/write access. HTTP status inference accepts
literal numeric codes and standardized HTTP status names; unknown expressions
remain unknown.

## Validation

Positive, negative, language-boundary, constructor, model extraction, access,
and HTTP-status cases live in `afyx-graph/engine/__tests__/ui-effects.test.ts`.
The source-provenance gate inventories AST regex literals and rejects known
historical classifier overlap independently of ownership metadata or hashes.
