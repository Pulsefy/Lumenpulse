use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum NotificationBrokerError {
    NotInitialized = 1700,
    AlreadyInitialized = 1701,
    SubscriptionNotFound = 1702,
    ReentrancyDetected = 1703,
}
