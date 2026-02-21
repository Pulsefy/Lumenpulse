import { xdr } from '@stellar/stellar-sdk';
import { Address } from '@stellar/stellar-sdk';

export interface DeploymentContext {
    adminPublicKey: string;
    networkPassphrase: string;
    /** Contract IDs of already deployed contracts, for cross-contract initialization */
    deployedContracts: Record<string, string>;
}

export interface ContractConfig {
    /** Key to use in the output JSON */
    name: string;
    /** Path to the WASM file relative to the scripts directory */
    wasmPath: string;
    /** Initialization configuration */
    init?: {
        /** Function name to call for initialization */
        fn: string;
        /** 
         * Arguments for the initialization function. 
         * Can be a static array of ScVal or a function returning them based on context.
         */
        args: (context: DeploymentContext) => xdr.ScVal[];
    };
}

export function getContractConfigs(): ContractConfig[] {
    // Determine paths dynamically or hardcode relative to this file
    // Assuming this file is in scripts/

    return [
        {
            name: 'token',
            wasmPath: '../apps/onchain/target/wasm32-unknown-unknown/release/lumen_token.wasm',
            init: {
                fn: 'initialize',
                args: ({ adminPublicKey }) => {
                    return [
                        new Address(adminPublicKey).toScVal(),
                        xdr.ScVal.scvU32(7), // decimal: 7
                        xdr.ScVal.scvString('LumenToken'), // name
                        xdr.ScVal.scvString('LUMEN'), // symbol
                    ];
                }
            }
        },
        {
            name: 'registry',
            wasmPath: '../apps/onchain/target/wasm32-unknown-unknown/release/contributor_registry.wasm',
            init: {
                fn: 'initialize',
                args: ({ adminPublicKey }) => {
                    return [new Address(adminPublicKey).toScVal()];
                }
            }
        },
        {
            name: 'vault',
            wasmPath: '../apps/onchain/target/wasm32-unknown-unknown/release/crowdfund_vault.wasm',
            init: {
                fn: 'initialize',
                args: ({ adminPublicKey }) => {
                    return [new Address(adminPublicKey).toScVal()];
                }
            }
        },
        {
            name: 'vesting_wallet',
            wasmPath: '../apps/onchain/target/wasm32-unknown-unknown/release/vesting_wallet.wasm',
            init: {
                fn: 'initialize',
                args: ({ adminPublicKey, deployedContracts }) => {
                    // Vesting wallet requires the token contract address
                    const tokenAddress = deployedContracts['token'];
                    if (!tokenAddress) {
                        throw new Error('Token contract must be deployed before vesting wallet');
                    }
                    return [
                        new Address(adminPublicKey).toScVal(),
                        new Address(tokenAddress).toScVal(),
                    ];
                }
            }
        }
    ];
}
