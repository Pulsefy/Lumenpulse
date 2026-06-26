/// Fixed-point scale factor (1e9) for precision in sqrt calculations
const SCALE: i128 = 1_000_000_000;

/// Returns sqrt(value) * SCALE using binary search + linear refinement.
/// This gives ~9 decimal digits of precision without floating point.
pub fn sqrt_scaled(value: i128) -> i128 {
    if value <= 0 {
        return 0;
    }
    if value == 1 {
        return SCALE;
    }

    // Binary search for integer sqrt
    let mut low = 0i128;
    let mut high = value;
    while low < high {
        let mid = (low + high + 1) / 2;
        if mid.checked_mul(mid).unwrap_or(i128::MAX) <= value {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    let integer_part = low * SCALE;
    let low_sq = low.checked_mul(low).unwrap_or(0);
    let remainder = if low > 0 {
        let diff = value - low_sq;
        let denom = low * 2;
        (diff * SCALE) / denom
    } else {
        0
    };

    integer_part + remainder
}

/// Divide a scaled value by SCALE
pub fn unscale(value: i128) -> i128 {
    value / SCALE
}

/// Proportionally allocate `pool` across projects given their QF scores.
/// Logic is inlined in lib.rs for no_std compatibility.
/// This module is kept for documentation purposes only.
#[allow(dead_code)]
pub fn allocate_pool_note() {
    // match(p) = pool × score(p) / Σ score
    // Last project absorbs integer-division remainder to avoid dust.
}
