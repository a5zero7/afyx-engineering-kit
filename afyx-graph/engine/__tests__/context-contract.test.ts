/**
 * Context behavior contract.
 *
 * Runs ContextBuilder and the context renderers through a fixed corpus - a
 * deterministic in-memory graph (every branch of seeding, re-ranking, expansion,
 * budgeting and rendering), hand-built renderer inputs, and a small real index -
 * and compares the results with a golden recorded from the implementation before
 * replacement. It asserts observable behavior only.
 *
 * The golden must never be regenerated to make a change pass. Recording is opt-in
 * and only meant for adding corpus categories: AFYX_CONTEXT_CONTRACT_WRITE=1.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeContextContract } from './context-contract/compute';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'context-contract.golden.json');

describe('context behavior contract', async () => {
  const actual = JSON.parse(JSON.stringify(await computeContextContract())) as Record<string, any>;

  if (process.env.AFYX_CONTEXT_CONTRACT_WRITE === '1') {
    it('records the golden', () => {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
    });
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, any>;

  it('covers exactly the recorded worlds and sections', () => {
    expect(Object.keys(actual.worlds).sort()).toEqual(Object.keys(golden.worlds).sort());
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  for (const world of Object.keys(golden.worlds)) {
    const expectedQueries = golden.worlds[world].queries as Array<Record<string, any>>;
    it(`${world}: node labels and code extraction are unchanged`, () => {
      expect(actual.worlds[world].labels).toEqual(golden.worlds[world].labels);
      expect(actual.worlds[world].code).toEqual(golden.worlds[world].code);
    });
    it(`${world}: minScore boundary sweep is unchanged`, () => {
      expect(actual.worlds[world].sweep).toEqual(golden.worlds[world].sweep);
    });
    it(`${world}: findRelevantContext default results are unchanged (${expectedQueries.length} queries)`, () => {
      expect(actual.worlds[world].queries.map((record: any) => [record.query, record.default])).toEqual(expectedQueries.map((record) => [record.query, record.default]));
    });
    it(`${world}: option variants are unchanged`, () => {
      expect(actual.worlds[world].queries.map((record: any) => record.variants)).toEqual(expectedQueries.map((record) => record.variants));
    });
    it(`${world}: buildContext structure is unchanged`, () => {
      expect(actual.worlds[world].queries.map((record: any) => record.context)).toEqual(expectedQueries.map((record) => record.context));
    });
    it(`${world}: rendered markdown and json are unchanged`, () => {
      expect(actual.worlds[world].queries.map((record: any) => record.rendered)).toEqual(expectedQueries.map((record) => record.rendered));
    });
  }

  for (const name of Object.keys(golden.formatters)) {
    it(`formatter ${name} is unchanged`, () => {
      expect(actual.formatters[name]).toEqual(golden.formatters[name]);
    });
  }

  it('real-index facts are unchanged', () => {
    expect(actual.realIndex).toEqual(golden.realIndex);
  });
}, 120_000);
