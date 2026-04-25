use soroban_sdk::{Symbol};

#[derive(Debug)]
pub enum AccessControlError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    RoleNotFound = 4,
    RoleAlreadyExists = 5,
    RoleAlreadyGranted = 6,
    RoleNotGranted = 7,
    PermissionNotFound = 8,
    PermissionAlreadyExists = 9,
    PermissionAlreadyGranted = 10,
    PermissionNotGranted = 11,
    AlreadyTrusted = 12,
    NotTrusted = 13,
    ResourceAlreadyRegistered = 14,
}

impl Into<Symbol> for AccessControlError {
    fn into(self) -> Symbol {
        match self {
            AccessControlError::NotInitialized => Symbol::short("ERR_NOTINIT"),
            AccessControlError::AlreadyInitialized => Symbol::short("ERR_ALRIND"),
            AccessControlError::Unauthorized => Symbol::short("ERR_UNAUTH"),
            AccessControlError::RoleNotFound => Symbol::short("ERR_RNFND"),
            AccessControlError::RoleAlreadyExists => Symbol::short("ERR_REXS"),
            AccessControlError::RoleAlreadyGranted => Symbol::short("ERR_RGRAN"),
            AccessControlError::RoleNotGranted => Symbol::short("ERR_RNGRAN"),
            AccessControlError::PermissionNotFound => Symbol::short("ERR_PNFND"),
            AccessControlError::PermissionAlreadyExists => Symbol::short("ERR_PEXS"),
            AccessControlError::PermissionAlreadyGranted => Symbol::short("ERR_PGRAN"),
            AccessControlError::PermissionNotGranted => Symbol::short("ERR_PNGRAN"),
            AccessControlError::AlreadyTrusted => Symbol::short("ERR_ATRST"),
            AccessControlError::NotTrusted => Symbol::short("ERR_NTRST"),
            AccessControlError::ResourceAlreadyRegistered => Symbol::short("ERR_RREG"),
        }
    }
}
