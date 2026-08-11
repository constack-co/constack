import { describe, expect, it } from 'vitest';
import { ANALYSIS_SCHEMA_VERSION, externalAnalysisResponseSchema } from './index.js';

describe('recommendation-only contract', () => {
  it.each(['action', 'patch', 'queueName', 'confirmationToken', 'executionMetadata'])(
    'rejects the executable field %s',
    (field) => {
      const result = externalAnalysisResponseSchema.safeParse({
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        summary: 'Review the replica policy.',
        probableCauses: [],
        evidenceReferences: [],
        investigationSteps: [],
        suggestedChanges: [],
        illustrativeSnippets: [],
        risk: 'medium',
        confidence: 0.5,
        [field]: field === 'patch' ? {} : 'forbidden',
      });
      expect(result.success).toBe(false);
    },
  );
});
