use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum NotificationBrokerError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    SubscriptionNotFound = 3,
    ReentrancyDetected = 4,
}
