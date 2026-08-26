use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum NotificationBrokerError {
    NotInitialized = 900,
    AlreadyInitialized = 901,
    SubscriptionNotFound = 902,
    ReentrancyDetected = 903,
}
