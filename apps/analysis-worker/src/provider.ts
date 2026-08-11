import {
  externalAnalysisRequestSchema,
  externalAnalysisResponseSchema,
  type ExternalAnalysisProvider,
  type ExternalAnalysisRequest,
  type ExternalAnalysisResponse,
} from '@constack/analysis-contracts';

export class GenericHttpAnalysisProvider implements ExternalAnalysisProvider {
  readonly id = 'generic-http';

  constructor(
    private readonly endpoint: URL,
    private readonly authHeader: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async analyze(input: ExternalAnalysisRequest): Promise<ExternalAnalysisResponse> {
    const request = externalAnalysisRequestSchema.parse(input);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.authHeader) {
      const separator = this.authHeader.indexOf(':');
      if (separator <= 0)
        throw new Error('EXTERNAL_ANALYSIS_AUTH_HEADER must use "Header-Name: value" format');
      headers[this.authHeader.slice(0, separator).trim()] = this.authHeader
        .slice(separator + 1)
        .trim();
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Analysis endpoint returned HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1_000_000) throw new Error('Analysis response exceeds the 1 MB limit');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > 1_000_000)
      throw new Error('Analysis response exceeds the 1 MB limit');
    return externalAnalysisResponseSchema.parse(JSON.parse(body));
  }
}
