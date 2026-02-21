import {
    rpc,
    TransactionBuilder,
    Operation,
    Keypair,
    TimeoutInfinite,
    xdr,
    StrKey,
    Address,
} from '@stellar/stellar-sdk';
import * as crypto from 'crypto';

export async function waitForTransaction(
    server: rpc.Server,
    hash: string
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    let status = 'PENDING';
    let txResponse: rpc.Api.GetTransactionResponse | undefined;

    while (status === 'PENDING' || status === 'NOT_FOUND') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
            txResponse = await server.getTransaction(hash);
            if (txResponse.status === 'SUCCESS') {
                return txResponse as rpc.Api.GetSuccessfulTransactionResponse;
            } else if (txResponse.status === 'FAILED') {
                const failed = txResponse as rpc.Api.GetFailedTransactionResponse;
                throw new Error(
                    `Transaction failed: ${JSON.stringify(failed.resultXdr)}`
                );
            }
            status = txResponse.status;
        } catch (e) {
            if (e instanceof Error && e.message.includes('not found')) {
                status = 'NOT_FOUND';
            } else {
                console.warn('Error fetching transaction:', e);
            }
        }
    }

    if (!txResponse) {
        throw new Error('Transaction wait failed unexpectedly');
    }
    throw new Error('Transaction ended in non-success state');
}

export function computeWasmHash(wasmBuffer: Buffer): string {
    return crypto.createHash('sha256').update(wasmBuffer).digest('hex');
}

export function parseContractIdFromCreateResult(
    resultXdr: xdr.TransactionResult
): string {
    throw new Error('This function should not be used for InvokeHostFunction based contract creation. Use returnValue instead.');
}

export async function uploadWasm(
    server: rpc.Server,
    adminKeypair: Keypair,
    networkPassphrase: string,
    wasmFile: Buffer
): Promise<string> {
    const account = await server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase,
    })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmFile }))
        .setTimeout(TimeoutInfinite)
        .build();

    tx.sign(adminKeypair);

    const submission = await server.sendTransaction(tx);

    if (submission.status === 'ERROR') {
        throw new Error(`Upload WASM failed: ${JSON.stringify(submission)}`);
    }

    await waitForTransaction(server, submission.hash);
    return computeWasmHash(wasmFile);
}

export async function createContract(
    server: rpc.Server,
    adminKeypair: Keypair,
    networkPassphrase: string,
    wasmHashStub: string
): Promise<string> {
    const account = await server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase,
    })
        // @ts-ignore - createCustomContract exists in runtime but types might differ or be strict
        .addOperation(Operation.createCustomContract({
            wasmHash: Buffer.from(wasmHashStub, 'hex'),
        }))
        .setTimeout(TimeoutInfinite)
        .build();

    tx.sign(adminKeypair);

    const submission = await server.sendTransaction(tx);

    if (submission.status === 'ERROR') {
        throw new Error(`Create Contract failed: ${JSON.stringify(submission)}`);
    }

    const result = await waitForTransaction(server, submission.hash);

    if (result.returnValue) {
        const val = result.returnValue;
        return Address.fromScVal(val).toString();
    }

    throw new Error('No return value from contract creation');
}

export async function initializeContract(
    server: rpc.Server,
    adminKeypair: Keypair,
    networkPassphrase: string,
    contractId: string,
    functionName: string,
    args: xdr.ScVal[]
): Promise<void> {
    const account = await server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase,
    })
        .addOperation(
            Operation.invokeContractFunction({
                contract: contractId,
                function: functionName,
                args: args,
            })
        )
        .setTimeout(TimeoutInfinite)
        .build();

    tx.sign(adminKeypair);

    const submission = await server.sendTransaction(tx);

    if (submission.status === 'ERROR') {
        throw new Error(`Initialize failed: ${JSON.stringify(submission)}`);
    }

    await waitForTransaction(server, submission.hash);
}
