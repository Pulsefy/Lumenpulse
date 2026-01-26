import {
    Keypair,
    Networks,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { uploadWasm, createContract, initializeContract } from './utils';
import { getContractConfigs, DeploymentContext } from './contracts.config';

dotenv.config();

const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
    console.error('ADMIN_SECRET not set in .env');
    process.exit(1);
}

const server = new rpc.Server(RPC_URL);

async function main() {
    try {
        const adminKeypair = Keypair.fromSecret(ADMIN_SECRET!);
        const adminPublicKey = adminKeypair.publicKey();
        console.log(`Using Admin Account: ${adminPublicKey}`);

        const context: DeploymentContext = {
            adminPublicKey,
            networkPassphrase: NETWORK_PASSPHRASE
        };

        const configs = getContractConfigs();
        const output: Record<string, string> = {
            network: NETWORK_PASSPHRASE,
            admin: adminPublicKey,
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
            const wasmHash = await uploadWasm(server, adminKeypair, NETWORK_PASSPHRASE, wasmFile);
            console.log(`WASM Hash: ${wasmHash}`);

            // 3. Create Contract
            console.log('Creating Contract...');
            const contractId = await createContract(server, adminKeypair, NETWORK_PASSPHRASE, wasmHash);
            console.log(`Contract ID: ${contractId}`);

            // 4. Initialize
            if (config.init) {
                console.log(`Initializing with function: ${config.init.fn}...`);
                const args = config.init.args(context);
                await initializeContract(
                    server,
                    adminKeypair,
                    NETWORK_PASSPHRASE,
                    contractId,
                    config.init.fn,
                    args
                );
                console.log('Initialized.');
            }

            output[config.name] = contractId;
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
