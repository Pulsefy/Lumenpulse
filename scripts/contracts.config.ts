import { xdr } from '@stellar/stellar-sdk';
import { Address } from '@stellar/stellar-sdk';

export interface DeploymentContext {
    adminPublicKey: string;
    networkPassphrase: string;
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
            name: 'vault',
            wasmPath: '../apps/onchain/target/wasm32-unknown-unknown/release/crowdfund_vault.wasm',
            init: {
                fn: 'initialize',
                args: ({ adminPublicKey }) => {
                    return [new Address(adminPublicKey).toScVal()];
                }
            }
        }
    ];
}
