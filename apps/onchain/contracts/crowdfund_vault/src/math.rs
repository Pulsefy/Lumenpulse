/// Fixed-point arithmetic utilities for quadratic funding calculations
/// Uses a scaling factor of 1e9 (1_000_000_000) for precision
///
/// Scale factor for fixed-point arithmetic (1e9)
const SCALE: i128 = 1_000_000_000;

/// Calculate integer square root using binary search with fixed-point arithmetic
/// Returns sqrt(value) * SCALE to maintain precision
///
/// We want to find x such that (x / SCALE)^2 ≈ value
/// This means x^2 / SCALE^2 ≈ value, so x^2 ≈ value * SCALE^2
pub fn sqrt_scaled(value: i128) -> i128 {
    if value <= 0 {
        return 0;
    }

    if value == 1 {
        return SCALE;
    }

    // Calculate target = value * SCALE^2
    // But to avoid overflow, we'll work differently:
    // We want sqrt(value) * SCALE
    // Let's find the integer square root of (value * SCALE^2)
    // But we need to be careful about overflow

    // Alternative approach: find sqrt(value) first, then scale
    // Use binary search on value itself, then scale the result

    let mut low = 0i128;
    let mut high = value;

    // Binary search for integer square root of value
    while low < high {
        let mid = (low + high + 1) / 2;

        // Check if mid^2 <= value
        let mid_squared = mid.checked_mul(mid).unwrap_or(i128::MAX);

        if mid_squared <= value {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    // Now scale the result: low * SCALE
    // But we need more precision, so we'll use a refinement
    // For better precision, we can calculate: low * SCALE + remainder
    let integer_part = low * SCALE;

    // Calculate remainder for better precision
    // remainder = (value - low^2) * SCALE / (2 * low + 1) approximately
    let low_squared = low.checked_mul(low).unwrap_or(0);
    let remainder = if low > 0 {
        let diff = value - low_squared;
        // Use linear approximation: diff * SCALE / (2 * low)
        let denominator = low * 2;
        if denominator > 0 {
            (diff * SCALE) / denominator
        } else {
            0
        }
    } else {
        0
    };

    integer_part + remainder
}

/// Divide a scaled value by SCALE to get the actual value
pub fn unscale(value: i128) -> i128 {
    value / SCALE
}

/// Multiply a value by SCALE to get scaled value
#[allow(dead_code)]
pub fn scale(value: i128) -> i128 {
    value * SCALE
}
