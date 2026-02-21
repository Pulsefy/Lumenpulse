
$ErrorActionPreference = "Stop"

echo "1. Registering User..."
try {
    $register = Invoke-RestMethod -Uri "http://localhost:3000/auth/register" -Method Post -Body (@{email="test@example.com"; password="password"} | ConvertTo-Json) -ContentType "application/json"
    echo "Registered successfully."
} catch {
    echo "Registration failed or user exists: $_"
}

echo "`n2. Logging in..."
$login = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method Post -Body (@{email="test@example.com"; password="password"} | ConvertTo-Json) -ContentType "application/json"
$token = $login.access_token

if (-not $token) {
    echo "Login failed. No token received."
    exit 1
}
echo "Token received."

echo "`n3. Accessing Protected Route (with token)..."
try {
    $profile = Invoke-RestMethod -Uri "http://localhost:3000/auth/profile" -Method Get -Headers @{Authorization = "Bearer $token"}
    echo "Profile accessed: $($profile.email)"
} catch {
    echo "Protected route access failed: $_"
    exit 1
}

echo "`n4. Accessing Protected Route (without token)..."
try {
    Invoke-RestMethod -Uri "http://localhost:3000/auth/profile" -Method Get
    echo "Error: Protected route accessible without token!"
    exit 1
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
        echo "Success: Access denied (401) as expected."
    } else {
        echo "Unexpected error code: $status"
        exit 1
    }
}

echo "`nVerification Complete!"
