import { describe, expect, it } from 'vitest';
import { actionPreviewRequestSchema } from '@constack/shared-types';

describe('human action request boundary', () => {
  it('rejects recommendation-originated fields', () => {
    const parsed = actionPreviewRequestSchema.safeParse({
      action: 'scale-deployment',
      resourceId: 'resource',
      parameters: { replicas: 3 },
      recommendationId: 'must-not-be-accepted',
    });
    expect(parsed.success).toBe(false);
  });
});
