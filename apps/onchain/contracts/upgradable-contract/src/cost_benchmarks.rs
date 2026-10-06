extern crate std;

use crate::{
    storage::{QueuedOperation, TimelockAction, MIN_DELAY_SECONDS},
    DataKey, UpgradableContract, UpgradableContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn measure<T>(env: &Env, name: &str, call: impl FnOnce() -> T) -> T {
    let result = call();
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"upgradable-contract\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}", r.instructions, r.memory_read_entries + r.disk_read_entries, r.write_entries);
    result
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let next_admin = Address::generate(&env);
    let id = env.register(UpgradableContract, ());
    let c = UpgradableContractClient::new(&env, &id);
    measure(&env, "init", || c.init(&admin));
    measure(&env, "increment", || c.increment());
    measure(&env, "get_count", || c.get_count());
    measure(&env, "get_admin", || c.get_admin());
    measure(&env, "propose_admin_rotation", || {
        c.propose_admin_rotation(&admin, &next_admin)
    });
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &next_admin)
    });
    measure(&env, "accept_admin_rotation", || {
        c.accept_admin_rotation(&next_admin)
    });
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &admin)
    });
    measure(&env, "cancel_admin_rotation", || {
        c.cancel_admin_rotation(&next_admin)
    });

    let op_cancel = QueuedOperation {
        proposer: next_admin.clone(),
        action: TimelockAction::SetAdmin(admin.clone()),
        execute_after: 1,
        expires_at: 100_000,
        created_at: 0,
    };
    let op_execute = QueuedOperation {
        proposer: next_admin.clone(),
        action: TimelockAction::SetAdmin(admin.clone()),
        execute_after: 1,
        expires_at: 100_000,
        created_at: 0,
    };
    env.as_contract(&id, || {
        env.storage()
            .persistent()
            .set(&DataKey::QueuedOperation(41), &op_cancel);
        env.storage()
            .persistent()
            .set(&DataKey::QueuedOperation(42), &op_execute);
        env.storage()
            .instance()
            .set(&DataKey::NextOperationId, &43u32);
    });
    measure(&env, "queue_operation", || {
        c.queue_operation(&next_admin, &TimelockAction::SetAdmin(admin.clone()))
    });
    measure(&env, "get_operation", || c.get_operation(&41));
    measure(&env, "get_operation_status", || c.get_operation_status(&41));
    measure(&env, "cancel_operation", || {
        c.cancel_operation(&next_admin, &41)
    });
    env.ledger().set_timestamp(MIN_DELAY_SECONDS + 1);
    measure(&env, "execute_operation", || {
        c.execute_operation(&next_admin, &42)
    });
    measure(&env, "contract_version", || c.contract_version());
    assert_eq!(measure(&env, "version", || c.version()), 1);
}
