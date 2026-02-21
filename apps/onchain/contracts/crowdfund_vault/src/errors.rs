use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrowdfundError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ProjectNotFound = 4,
    MilestoneNotApproved = 5,
    InsufficientBalance = 6,
    ProjectNotActive = 7,
    InvalidAmount = 8,
    AlreadyRegistered = 9,
    ContributorNotFound = 10,
    ContractPaused = 11,
    ProjectAlreadyCanceled = 12,
    ProjectNotCancellable = 13,
    RefundFailed = 14,
    ContractNotPaused = 15,
}
