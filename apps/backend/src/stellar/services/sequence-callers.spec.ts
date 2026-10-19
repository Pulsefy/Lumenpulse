const mockConfig = {
  featureFlags: { useMockTransactions: false },
  stellar: {
    network: 'testnet',
    serverSecret: { reveal: jest.fn() },
    contracts: {
      matchingPool: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
      treasury: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
      contributorRegistry:
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
    },
  },
};
jest.mock('../../lib/config', () => ({ config: mockConfig }));
jest.mock('@stellar/stellar-sdk', () => {
  const sdk = jest.requireActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );
  return { ...sdk, rpc: { ...sdk.rpc } };
});

import {
  Account,
  Address,
  Keypair,
  Transaction,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { CacheService } from '../../cache/cache.service';
import { ContributorRegistryService } from '../../contributor-registry/contributor-registry.service';
import { TreasurySorobanClient } from '../../treasury/treasury-soroban.client';
import { VestingWalletSorobanClient } from '../../vesting-wallet/vesting-wallet-soroban.client';
import { MatchingPoolAdminService } from './matching-pool-admin.service';
import {
  SorobanErrorCode,
  SorobanRpcClientService,
  SorobanRpcError,
} from './soroban-rpc-client.service';

const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const beneficiary = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const contract = mockConfig.stellar.contracts.treasury;

describe('Server-signed callers use shared sequence coordination', () => {
  let client: {
    withSequence: jest.Mock;
    simulateTransaction: jest.Mock;
    sendTransaction: jest.Mock;
    getTransaction: jest.Mock;
  };
  let matching: MatchingPoolAdminService;
  let treasury: TreasurySorobanClient;
  let vesting: VestingWalletSorobanClient;
  let contributors: ContributorRegistryService;

  beforeEach(() => {
    mockConfig.stellar.serverSecret.reveal.mockReturnValue(signer.secret());
    client = {
      withSequence: jest.fn(
        (source: string, operation: (account: Account) => Promise<unknown>) =>
          operation(new Account(source, '100')),
      ),
      simulateTransaction: jest.fn().mockResolvedValue({}),
      sendTransaction: jest
        .fn()
        .mockResolvedValue({ hash: 'submitted', status: 'PENDING' }),
      getTransaction: jest.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 123,
      }),
    };
    jest.spyOn(rpc, 'assembleTransaction').mockImplementation(((
      tx: Transaction,
    ) => ({
      build: () => tx,
    })) as never);
    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(false);
    const rpcClient = client as unknown as SorobanRpcClientService;
    matching = new MatchingPoolAdminService(rpcClient);
    treasury = new TreasurySorobanClient(rpcClient);
    vesting = new VestingWalletSorobanClient(rpcClient);
    contributors = new ContributorRegistryService(
      {} as CacheService,
      rpcClient,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  function signedAuth(): string {
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: new Address(contract).toScAddress(),
              functionName: 'register_contributor_with_sig',
              args: [],
            }),
          ),
        subInvocations: [],
      }),
    }).toXDR('base64');
  }

  const params = { beneficiary, amount: '1000', startTime: 1, duration: 100 };
  const calls: Array<[string, () => Promise<unknown>]> = [
    [
      'create_round',
      () =>
        matching.createRound({ name: 'round', matchingFunds: 1000 }, 'admin'),
    ],
    [
      'approve_project',
      () =>
        matching.approveProject(
          'round',
          { projectAddress: beneficiary },
          'admin',
        ),
    ],
    ['allocate_budget', () => treasury.allocateBudget(params)],
    [
      'rotate_beneficiary',
      () =>
        treasury.rotateBeneficiary({
          oldBeneficiary: signer.publicKey(),
          newBeneficiary: beneficiary,
        }),
    ],
    ['create_vesting', () => vesting.createVesting(params)],
    [
      'create_vesting_with_milestone',
      () =>
        vesting.createVestingWithMilestone({
          ...params,
          vaultContract: contract,
          projectId: 1,
          milestoneId: 1,
        }),
    ],
    [
      'register_contributor_with_sig',
      () =>
        contributors.registerWithSignature({
          githubHandle: 'contributor',
          address: beneficiary,
          signedAuthEntryXdr: signedAuth(),
        }),
    ],
  ];

  it.each(calls)(
    '%s builds, simulates, signs, and submits inside the shared boundary',
    async (_name, invoke) => {
      await invoke();
      expect(client.withSequence).toHaveBeenCalledWith(
        signer.publicKey(),
        expect.any(Function),
      );
      expect(client.simulateTransaction).toHaveBeenCalledTimes(1);
      expect(client.sendTransaction).toHaveBeenCalledTimes(1);
      const tx = client.sendTransaction.mock.calls[0][0] as Transaction;
      expect(tx.sequence).toBe('101');
      expect(tx.signatures).toHaveLength(1);
      expect(signer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    },
  );

  it.each(calls)(
    '%s rebuilds and resimulates using the fresh account supplied on retry',
    async (_name, invoke) => {
      client.withSequence.mockImplementation(
        async (
          _source: string,
          operation: (account: Account) => Promise<unknown>,
        ) => {
          await operation(new Account(signer.publicKey(), '100'));
          return operation(new Account(signer.publicKey(), '150'));
        },
      );
      await invoke();
      expect(client.simulateTransaction).toHaveBeenCalledTimes(2);
      expect(
        client.sendTransaction.mock.calls.map(
          ([tx]) => (tx as Transaction).sequence,
        ),
      ).toEqual(['101', '151']);
      const transactions = client.sendTransaction.mock.calls.map(
        ([tx]) => tx as Transaction,
      );
      expect(transactions[0].hash()).not.toEqual(transactions[1].hash());
    },
  );

  it.each(['treasury', 'vesting'] as const)(
    'keeps exhausted contention as a typed %s transaction failure',
    async (domain) => {
      client.withSequence.mockRejectedValue(
        new SorobanRpcError(
          SorobanErrorCode.BAD_SEQUENCE,
          'bad sequence',
          undefined,
          'tx_bad_seq',
        ),
      );
      const result =
        domain === 'treasury'
          ? treasury.allocateBudget(params)
          : vesting.createVesting(params);
      await expect(result).rejects.toMatchObject({
        response: { details: { resultCode: 'tx_bad_seq' } },
      });
    },
  );
});
