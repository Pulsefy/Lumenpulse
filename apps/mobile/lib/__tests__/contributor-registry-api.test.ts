import { apiClient } from '../api-client';
import { contributorApi, type ContributorProfile } from '../contributor';

type Handler = (endpoint: string) => unknown;

function mockGet(handler: Handler) {
  const spy = jest.spyOn(apiClient, 'get') as unknown as jest.Mock;
  spy.mockImplementation((endpoint: string) => Promise.resolve(handler(endpoint)));
  return spy;
}

function mockPost(result: unknown) {
  const spy = jest.spyOn(apiClient, 'post') as unknown as jest.Mock;
  spy.mockImplementation(() => Promise.resolve(result));
  return spy;
}

const PROFILE: ContributorProfile = {
  address: 'GABC1234567890',
  githubHandle: 'octocat',
  reputationScore: 12,
  tier: 'Builder',
  registeredAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('contributorApi registry reads', () => {
  it('treats a 404 wallet lookup as an unregistered wallet, not an error', async () => {
    const get = mockGet((endpoint) => {
      if (endpoint.startsWith('/contributor-registry/wallet/')) {
        return { success: false, error: { message: 'Contributor not found', statusCode: 404 } };
      }
      return { success: false, error: { message: 'Contributor not found', statusCode: 404 } };
    });

    const result = await contributorApi.getRegistryState('GABC1234567890');

    expect(get).toHaveBeenCalledWith('/contributor-registry/wallet/GABC1234567890');
    expect(get).toHaveBeenCalledWith('/contributor-registry/reputation/GABC1234567890');
    expect(result.success).toBe(true);
    expect(result.data?.isRegistered).toBe(false);
    expect(result.data?.status).toBe('UNREGISTERED');
  });

  it('surfaces a non-404 failure instead of reporting an unregistered wallet', async () => {
    mockGet(() => ({ success: false, error: { message: 'Network request failed' } }));

    const result = await contributorApi.getRegistryState('GABC1234567890');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error?.message).toBe('Network request failed');
  });

  it('reports a registered wallet with its reputation and handle', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/reputation/')) {
        return {
          success: true,
          data: { address: PROFILE.address, reputationScore: 55, tier: 'Architect' },
        };
      }
      return { success: true, data: PROFILE };
    });

    const result = await contributorApi.getRegistryState('GABC1234567890');

    expect(result.success).toBe(true);
    expect(result.data?.isRegistered).toBe(true);
    expect(result.data?.isGithubLinked).toBe(true);
    expect(result.data?.githubHandle).toBe('octocat');
    expect(result.data?.reputation.score).toBe(55);
    expect(result.data?.reputation.tier).toBe('Architect');
    expect(result.data?.reputation.nextTier).toBe('Core');
  });

  it('still reports a registered wallet when the reputation read fails', async () => {
    mockGet((endpoint) => {
      if (endpoint.includes('/reputation/')) {
        return { success: false, error: { message: 'Contributor not found', statusCode: 404 } };
      }
      return { success: true, data: PROFILE };
    });

    const result = await contributorApi.getRegistryState('GABC1234567890');

    expect(result.success).toBe(true);
    expect(result.data?.isRegistered).toBe(true);
    expect(result.data?.reputation.score).toBe(PROFILE.reputationScore);
  });
});

describe('contributorApi registration endpoints', () => {
  it('reads the per-address registration nonce', async () => {
    const get = mockGet(() => ({ success: true, data: { address: 'GABC1234567890', nonce: 7 } }));

    const result = await contributorApi.getNonce('GABC1234567890');

    expect(get).toHaveBeenCalledWith('/contributor-registry/nonce/GABC1234567890');
    expect(result.data?.nonce).toBe(7);
  });

  it('builds the unsigned registration transaction through the register endpoint', async () => {
    const post = mockPost({
      success: true,
      data: { unsignedXdr: 'AAAA', networkPassphrase: 'Test SDF Network ; September 2015' },
    });

    const result = await contributorApi.buildRegistration({
      address: 'GABC1234567890',
      githubHandle: 'octocat',
    });

    expect(post).toHaveBeenCalledWith('/contributor-registry/register', {
      address: 'GABC1234567890',
      githubHandle: 'octocat',
    });
    expect(result.data?.unsignedXdr).toBe('AAAA');
  });

  it('submits the signed registration to the gasless endpoint', async () => {
    const post = mockPost({ success: true, data: { transactionHash: 'tx-1', status: 'SUCCESS' } });

    const result = await contributorApi.submitRegistration({
      address: 'GABC1234567890',
      githubHandle: 'octocat',
      signedAuthEntryXdr: 'AAAA',
      signatureHex: 'deadbeef',
    });

    expect(post).toHaveBeenCalledWith('/contributor-registry/register-with-sig', {
      address: 'GABC1234567890',
      githubHandle: 'octocat',
      signedAuthEntryXdr: 'AAAA',
      signatureHex: 'deadbeef',
    });
    expect(result.data?.transactionHash).toBe('tx-1');
  });
});
