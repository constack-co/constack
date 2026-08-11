import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SCHEMA_VERSION,
  externalAnalysisResponseSchema,
} from '@constack/analysis-contracts';

describe('recommendation-only provider boundary', () => {
  it.each(['action', 'patch', 'confirmationToken', 'queueName', 'execution'])(
    'rejects the executable field %s',
    (field) => {
      expect(
        externalAnalysisResponseSchema.safeParse({
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          summary: 'Investigate the rollout.',
          probableCauses: [],
          evidenceReferences: [],
          investigationSteps: [],
          suggestedChanges: [],
          illustrativeSnippets: [],
          risk: 'low',
          confidence: 0.5,
          [field]: 'forbidden',
        }).success,
      ).toBe(false);
    },
  );
});
