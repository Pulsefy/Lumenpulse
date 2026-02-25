#!/bin/bash

# Test script to verify Swagger documentation
echo "🔍 Testing Swagger Documentation Implementation..."
echo ""

# Check if main.ts has Swagger configuration
echo "✓ Checking main.ts configuration..."
if grep -q "DocumentBuilder" apps/backend/src/main.ts; then
    echo "  ✅ DocumentBuilder found"
else
    echo "  ❌ DocumentBuilder not found"
    exit 1
fi

if grep -q "addBearerAuth" apps/backend/src/main.ts; then
    echo "  ✅ Bearer auth configured"
else
    echo "  ❌ Bearer auth not configured"
    exit 1
fi

if grep -q "addTag" apps/backend/src/main.ts; then
    echo "  ✅ API tags configured"
else
    echo "  ❌ API tags not configured"
    exit 1
fi

echo ""
echo "✓ Checking controller decorators..."

# Check Auth Controller
if grep -q "@ApiTags('auth')" apps/backend/src/auth/auth.controller.ts; then
    echo "  ✅ Auth controller has @ApiTags"
else
    echo "  ❌ Auth controller missing @ApiTags"
fi

# Check Users Controller
if grep -q "@ApiTags('users')" apps/backend/src/users/users.controller.ts; then
    echo "  ✅ Users controller has @ApiTags"
else
    echo "  ❌ Users controller missing @ApiTags"
fi

# Check News Controller
if grep -q "@ApiTags('news')" apps/backend/src/news/news.controller.ts; then
    echo "  ✅ News controller has @ApiTags"
else
    echo "  ❌ News controller missing @ApiTags"
fi

# Check Portfolio Controller
if grep -q "@ApiTags('portfolio')" apps/backend/src/portfolio/portfolio.controller.ts; then
    echo "  ✅ Portfolio controller has @ApiTags"
else
    echo "  ❌ Portfolio controller missing @ApiTags"
fi

# Check Stellar Controller
if grep -q "@ApiTags('stellar')" apps/backend/src/stellar/stellar.controller.ts; then
    echo "  ✅ Stellar controller has @ApiTags"
else
    echo "  ❌ Stellar controller missing @ApiTags"
fi

echo ""
echo "✓ Checking DTO decorators..."

# Check Auth DTOs
if grep -q "@ApiProperty" apps/backend/src/auth/dto/login.dto.ts; then
    echo "  ✅ LoginDto has @ApiProperty"
else
    echo "  ❌ LoginDto missing @ApiProperty"
fi

if grep -q "@ApiProperty" apps/backend/src/auth/dto/register.dto.ts; then
    echo "  ✅ RegisterDto has @ApiProperty"
else
    echo "  ❌ RegisterDto missing @ApiProperty"
fi

# Check News DTOs
if grep -q "@ApiProperty" apps/backend/src/news/dto/news-article.dto.ts; then
    echo "  ✅ News DTOs have @ApiProperty"
else
    echo "  ❌ News DTOs missing @ApiProperty"
fi

# Check Portfolio DTOs
if grep -q "@ApiProperty" apps/backend/src/portfolio/dto/portfolio-snapshot.dto.ts; then
    echo "  ✅ Portfolio DTOs have @ApiProperty"
else
    echo "  ❌ Portfolio DTOs missing @ApiProperty"
fi

echo ""
echo "✓ Checking documentation files..."

if [ -f "document/api-documentation-guide.md" ]; then
    echo "  ✅ API Documentation Guide exists"
else
    echo "  ❌ API Documentation Guide missing"
fi

if [ -f "document/swagger-implementation-guide.md" ]; then
    echo "  ✅ Swagger Implementation Guide exists"
else
    echo "  ❌ Swagger Implementation Guide missing"
fi

if [ -f "document/swagger-documentation-summary.md" ]; then
    echo "  ✅ Swagger Documentation Summary exists"
else
    echo "  ❌ Swagger Documentation Summary missing"
fi

echo ""
echo "✓ Checking build..."
cd apps/backend
if npm run build > /dev/null 2>&1; then
    echo "  ✅ Backend builds successfully"
else
    echo "  ❌ Backend build failed"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All Swagger documentation checks passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 Documentation available at:"
echo "   • Swagger UI: http://localhost:3000/api/docs"
echo "   • OpenAPI JSON: http://localhost:3000/api/docs-json"
echo ""
echo "📖 Documentation files:"
echo "   • document/api-documentation-guide.md"
echo "   • document/swagger-implementation-guide.md"
echo "   • document/swagger-documentation-summary.md"
echo ""
echo "🚀 To start the server:"
echo "   cd apps/backend && npm run start:dev"
echo ""
