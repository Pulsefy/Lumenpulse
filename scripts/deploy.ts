import {
    Keypair,
    Networks,
    rpc,
    xdr,
    Horizon,
} from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { uploadWasm, createContract, initializeContract } from './utils';
import { getContractConfigs, DeploymentContext } from './contracts.config';

dotenv.config();

const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
    console.error('ADMIN_SECRET not set in .env');
    process.exit(1);
}

const rpcServer = new rpc.Server(SOROBAN_RPC_URL);
const horizonServer = new Horizon.Server(HORIZON_URL);

async function main() {
    try {
        const adminKeypair = Keypair.fromSecret(ADMIN_SECRET!);
        const adminPublicKey = adminKeypair.publicKey();
        console.log(`Using Admin Account: ${adminPublicKey}`);

        const configs = getContractConfigs();
        const output: Record<string, string> = {
            network: NETWORK_PASSPHRASE,
            admin: adminPublicKey,
        };

        const context: DeploymentContext = {
            adminPublicKey,
            networkPassphrase: NETWORK_PASSPHRASE,
            deployedContracts: output
        };

        for (const config of configs) {
            console.log(`\n--- Deploying ${config.name} ---`);

            // 1. Resolve WASM Path
            const wasmPath = path.resolve(__dirname, config.wasmPath);
            if (!fs.existsSync(wasmPath)) {
                throw new Error(`WASM file not found at ${wasmPath}`);
            }
            const wasmFile = fs.readFileSync(wasmPath);

            // 2. Upload WASM
            console.log('Uploading WASM...');
            const wasmHash = await uploadWasm(rpcServer, horizonServer, adminKeypair, NETWORK_PASSPHRASE, wasmFile, SOROBAN_RPC_URL);
            console.log(`WASM Hash: ${wasmHash}`);

            // 3. Create Contract
            console.log('Creating Contract...');
            const contractId = await createContract(rpcServer, horizonServer, adminKeypair, NETWORK_PASSPHRASE, wasmHash);
            console.log(`Contract ID: ${contractId}`);

            // Store contract ID before initialization so subsequent contracts can reference it
            output[config.name] = contractId;

            // 4. Initialize
            if (config.init) {
                console.log(`Initializing with function: ${config.init.fn}...`);
                const args = config.init.args(context);
                await initializeContract(
                    rpcServer,
                    horizonServer,
                    adminKeypair,
                    NETWORK_PASSPHRASE,
                    contractId,
                    config.init.fn,
                    args
                );
                console.log('Initialized.');
            }
        }

        // Output to JSON
        const outputPath = path.join(__dirname, 'contract-ids.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`\nDeployment Complete! Saved to ${outputPath}`);

    } catch (err) {
        console.error('Deployment Error:', err);
        process.exit(1);
    }
}

main();
