import {
  runContributorRegistration,
  buildRegistrationMessage,
  classifySubmissionError,
  createRegistrationFailure,
  isValidGithubHandle,
  normalizeGithubHandle,
  GITHUB_HANDLE_PATTERN,
  type RegistrationDeps,
  type RegistrationStage,
} from '../contributor-registration';

const ADDRESS = 'GABC1234567890';

function makeDeps(overrides: Partial<RegistrationDeps> = {}): RegistrationDeps {
  return {
    getNonce: jest.fn(async () => ({ success: true, data: { address: ADDRESS, nonce: 0 } })),
    requestSignature: jest.fn(async () => ({
      status: 'success' as const,
      signedAuthEntryXdr: 'AAAA',
    })),
    submitRegistration: jest.fn(async () => ({
      success: true,
      data: { transactionHash: 'tx-1', status: 'SUCCESS' },
    })),
    ...overrides,
  };
}

describe('GitHub handle validation', () => {
  it('accepts the handles the backend accepts', () => {
    expect(isValidGithubHandle('octocat')).toBe(true);
    expect(isValidGithubHandle('a')).toBe(true);
    expect(isValidGithubHandle('a-b-c')).toBe(true);
    expect(GITHUB_HANDLE_PATTERN.test('user123')).toBe(true);
  });

  it('rejects leading/trailing hyphens, spaces and empty handles', () => {
    expect(isValidGithubHandle('-octocat')).toBe(false);
    expect(isValidGithubHandle('octocat-')).toBe(false);
    expect(isValidGithubHandle('octo cat')).toBe(false);
    expect(isValidGithubHandle('')).toBe(false);
  });

  it('normalizes a leading @ and surrounding whitespace', () => {
    expect(normalizeGithubHandle('  @octocat ')).toBe('octocat');
    expect(normalizeGithubHandle('octocat')).toBe('octocat');
  });
});

describe('buildRegistrationMessage', () => {
  it('binds the method, address, handle and nonce the contract authorizes', () => {
    const message = buildRegistrationMessage({
      address: ADDRESS,
      githubHandle: 'octocat',
      nonce: 3,
    });

    expect(message).toContain('register_contributor_with_sig');
    expect(message).toContain(`address: ${ADDRESS}`);
    expect(message).toContain('github_handle: octocat');
    expect(message).toContain('nonce: 3');
  });
});

describe('runContributorRegistration', () => {
  it('rejects an invalid handle without touching the network', async () => {
    const deps = makeDeps();

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'not a handle',
      deps,
    });

    expect(result).toMatchObject({ status: 'failure', failure: { code: 'invalid_handle' } });
    expect(deps.getNonce).not.toHaveBeenCalled();
  });

  it('reports a missing wallet before doing anything else', async () => {
    const deps = makeDeps();

    const result = await runContributorRegistration({
      address: null,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({ status: 'failure', failure: { code: 'missing_address' } });
    expect(deps.getNonce).not.toHaveBeenCalled();
  });

  it('submits after signing against the fetched nonce', async () => {
    const deps = makeDeps();

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: '@octocat',
      deps,
    });

    expect(result).toEqual({
      status: 'success',
      submission: { transactionHash: 'tx-1', status: 'SUCCESS' },
    });
    expect(deps.submitRegistration).toHaveBeenCalledWith({
      address: ADDRESS,
      githubHandle: 'octocat',
      signedAuthEntryXdr: 'AAAA',
      signatureHex: undefined,
    });
  });

  it('reports an unreachable nonce as retryable', async () => {
    const deps = makeDeps({
      getNonce: jest.fn(async () => ({
        success: false,
        error: { message: 'Network request failed' },
      })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'nonce_unavailable', retryable: true },
    });
    expect(deps.requestSignature).not.toHaveBeenCalled();
  });

  it('reports a declined signature distinctly and submits nothing', async () => {
    const deps = makeDeps({
      requestSignature: jest.fn(async () => ({ status: 'rejected' as const })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'signature_rejected', retryable: true },
    });
    if (result.status === 'failure') {
      expect(result.failure.title).toBe('Signature declined');
    }
    expect(deps.submitRegistration).not.toHaveBeenCalled();
  });

  it('reports a wallet that could not sign separately from a decline', async () => {
    const deps = makeDeps({
      requestSignature: jest.fn(async () => ({
        status: 'failed' as const,
        message: 'Wallet locked',
      })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({ status: 'failure', failure: { code: 'signature_failed' } });
    if (result.status === 'failure') {
      expect(result.failure.message).toBe('Wallet locked');
    }
    expect(deps.submitRegistration).not.toHaveBeenCalled();
  });

  it('detects a nonce that advanced while the user was signing', async () => {
    const getNonce = jest
      .fn()
      .mockResolvedValueOnce({ success: true, data: { address: ADDRESS, nonce: 0 } })
      .mockResolvedValueOnce({ success: true, data: { address: ADDRESS, nonce: 1 } });
    const deps = makeDeps({ getNonce });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'nonce_expired', retryable: true },
    });
    if (result.status === 'failure') {
      expect(result.failure.title).toBe('Registration code expired');
    }
    expect(deps.submitRegistration).not.toHaveBeenCalled();
  });

  it('classifies a rejected submission as a taken handle', async () => {
    const deps = makeDeps({
      submitRegistration: jest.fn(async () => ({
        success: false,
        error: { message: "GitHub handle 'octocat' is already taken", statusCode: 409 },
      })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'handle_taken', retryable: false },
    });
  });

  it('classifies an already-registered submission distinctly from a taken handle', async () => {
    const deps = makeDeps({
      submitRegistration: jest.fn(async () => ({
        success: false,
        error: { message: `Contributor ${ADDRESS} is already registered`, statusCode: 409 },
      })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'already_registered', retryable: false },
    });
  });

  it('reports an unauthorized submission as non-retryable', async () => {
    const deps = makeDeps({
      submitRegistration: jest.fn(async () => ({
        success: false,
        error: { message: 'Forbidden resource', statusCode: 403 },
      })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'unauthorized', retryable: false },
    });
  });

  it('confirms a wallet-broadcast registration instead of assuming success', async () => {
    const deps = makeDeps({
      requestSignature: jest.fn(async () => ({
        status: 'success' as const,
        transactionHash: 'tx-9',
      })),
      verifyRegistration: jest.fn(async () => true),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toEqual({
      status: 'success',
      submission: { transactionHash: 'tx-9', status: 'SUCCESS' },
    });
    expect(deps.submitRegistration).not.toHaveBeenCalled();
  });

  it('reports an unconfirmed broadcast registration as retryable', async () => {
    const deps = makeDeps({
      requestSignature: jest.fn(async () => ({
        status: 'success' as const,
        transactionHash: 'tx-9',
      })),
      verifyRegistration: jest.fn(async () => false),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({
      status: 'failure',
      failure: { code: 'unconfirmed', retryable: true },
    });
  });

  it('reports an unconfirmed broadcast registration without a verifier', async () => {
    const deps = makeDeps({
      requestSignature: jest.fn(async () => ({ status: 'success' as const })),
    });

    const result = await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
    });

    expect(result).toMatchObject({ status: 'failure', failure: { code: 'unconfirmed' } });
  });

  it('emits the stages it walks through, ending on success', async () => {
    const stages: RegistrationStage[] = [];
    const deps = makeDeps();

    await runContributorRegistration({
      address: ADDRESS,
      githubHandle: 'octocat',
      deps,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual([
      'fetching_nonce',
      'awaiting_signature',
      'revalidating_nonce',
      'submitting',
      'success',
    ]);
  });

  it('never throws when a dependency rejects', async () => {
    const deps = makeDeps({
      getNonce: jest.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(
      runContributorRegistration({ address: ADDRESS, githubHandle: 'octocat', deps }),
    ).resolves.toMatchObject({ status: 'failure', failure: { code: 'unknown' } });
  });
});

describe('classifySubmissionError', () => {
  it('treats a nonce message as an expired code regardless of status', () => {
    expect(
      classifySubmissionError({ message: 'Registration nonce is stale', statusCode: 400 }).code,
    ).toBe('nonce_expired');
  });

  it('treats a status-less error as a network problem', () => {
    expect(classifySubmissionError({ message: 'Network request failed' }).code).toBe('network');
  });

  it('falls back to unknown for an unclassified server error', () => {
    expect(
      classifySubmissionError({ message: 'Internal server error', statusCode: 500 }).code,
    ).toBe('unknown');
  });

  it('classifies a malformed authorization entry as a signing failure', () => {
    expect(
      classifySubmissionError({ message: 'Invalid signedAuthEntryXdr', statusCode: 400 }).code,
    ).toBe('signature_failed');
  });
});

describe('createRegistrationFailure', () => {
  it('falls back to the default copy when no server detail is supplied', () => {
    const failure = createRegistrationFailure('signature_rejected');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain('Tap Register to try again');
  });

  it('prefers server detail when it is present', () => {
    const failure = createRegistrationFailure('signature_failed', 'Wallet locked');
    expect(failure.message).toBe('Wallet locked');
  });
});
