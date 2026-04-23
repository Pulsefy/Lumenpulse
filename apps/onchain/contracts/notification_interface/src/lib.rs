#![no_std]

use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notification {
    pub source: Address,
    pub event_type: Symbol,
    pub data: Bytes,
}

#[contractclient(name = "NotificationReceiverClient")]
pub trait NotificationReceiverTrait {
    fn on_notify(env: Env, notification: Notification);
}
