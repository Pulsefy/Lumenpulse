use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum NotificationBrokerError {
    NotInitialized = 1701,
    AlreadyInitialized = 1702,
    SubscriptionNotFound = 1703,
    ReentrancyDetected = 1704,
}
