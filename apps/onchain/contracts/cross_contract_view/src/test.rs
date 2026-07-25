#![cfg(test)]

use super::*;
use soroban_sdk::{Env, Symbol};

#[test]
fn view_error_can_be_rendered_as_symbol() {
    let env = Env::default();
    let error = ViewError::UnsupportedView;
    let symbol = error.as_symbol(&env);
    assert_eq!(symbol, Symbol::new(&env, "unsupported_view"));
}
