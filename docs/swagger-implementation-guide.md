# Swagger/OpenAPI Implementation Guide

## Overview

This guide explains how Swagger/OpenAPI documentation is implemented in the LumenPulse backend and provides best practices for maintaining and extending it.

## Architecture

### Configuration

The Swagger configuration is set up in `src/main.ts`:

```typescript
const config = new DocumentBuilder()
  .setTitle('LumenPulse API')
  .setDescription('Comprehensive API documentation...')
  .setVersion('1.0')
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Enter JWT token',
    },
    'JWT-auth',
  )
  .addTag('auth', 'Authentication and authorization endpoints')
  .addTag('users', 'User profile and account management')
  .addTag('news', 'Crypto news aggregation and sentiment analysis')
  .addTag('portfolio', 'Portfolio tracking and performance metrics')
  .addTag('stellar', 'Stellar blockchain integration')
  .addServer('http://localhost:3000', 'Development')
  .addServer('https://api.lumenpulse.io', 'Production')
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);
```

### Key Components

1. **Controllers**: Define endpoints and operations
2. **DTOs**: Define request/response schemas
3. **Decorators**: Add metadata for documentation

## Decorators Reference

### Controller-Level Decorators

#### `@ApiTags()`

Groups endpoints in the Swagger UI:

```typescript
@ApiTags('users')
@Controller('users')
export class UsersController {}
```

#### `@ApiBearerAuth()`

Indicates endpoints require JWT authentication:

```typescript
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {}
```

### Endpoint-Level Decorators

#### `@ApiOperation()`

Describes the endpoint:

```typescript
@Get('profile')
@ApiOperation({ 
  summary: 'Get current user profile',
  description: 'Returns detailed profile information for the authenticated user'
})
async getProfile() {}
```

#### `@ApiResponse()`

Documents response schemas and status codes:

```typescript
@Post('login')
@ApiResponse({
  status: 200,
  description: 'Login successful',
  schema: {
    properties: {
      access_token: { type: 'string' },
      refresh_token: { type: 'string' }
    }
  }
})
@ApiResponse({ 
  status: 401, 
  description: 'Invalid credentials' 
})
async login() {}
```

For DTO responses:

```typescript
@Get('history')
@ApiResponse({
  status: 200,
  description: 'Portfolio history retrieved successfully',
  type: PortfolioHistoryResponseDto,
})
async getPortfolioHistory() {}
```

#### `@ApiQuery()`

Documents query parameters:

```typescript
@Get('news')
@ApiQuery({ 
  name: 'limit', 
  required: false, 
  type: Number, 
  example: 20,
  description: 'Maximum number of articles to return'
})
async getNews(@Query('limit') limit?: string) {}
```

#### `@ApiParam()`

Documents path parameters:

```typescript
@Get('coin/:symbol')
@ApiParam({ 
  name: 'symbol', 
  type: String, 
  example: 'BTC',
  description: 'Cryptocurrency symbol'
})
async getNewsByCoin(@Param('symbol') symbol: string) {}
```

### DTO-Level Decorators

#### `@ApiProperty()`

Documents required properties:

```typescript
export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'User password (minimum 6 characters)',
    example: 'SecurePass123!',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password: string;
}
```

#### `@ApiPropertyOptional()`

Documents optional properties:

```typescript
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Display name for user',
    example: 'John Doe',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;
}
```

### Advanced Property Options

```typescript
@ApiProperty({
  description: 'Property description',
  example: 'Example value',
  type: String,              // Explicit type
  enum: ['A', 'B', 'C'],    // Enum values
  nullable: true,            // Can be null
  required: false,           // Optional property
  minimum: 1,                // Min value (numbers)
  maximum: 100,              // Max value (numbers)
  minLength: 6,              // Min length (strings)
  maxLength: 255,            // Max length (strings)
  format: 'date-time',       // Format hint
  isArray: true,             // Array type
  default: 10,               // Default value
})
```

## Best Practices

### 1. Complete Documentation

Every public endpoint should have:
- `@ApiOperation()` with summary and description
- `@ApiResponse()` for success (200/201)
- `@ApiResponse()` for common errors (400, 401, 404, 500)
- Query/param documentation where applicable

### 2. Meaningful Examples

Provide realistic examples:

```typescript
@ApiProperty({
  description: 'Stellar public key',
  example: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
})
publicKey: string;
```

### 3. Detailed Descriptions

Be specific about what the field represents:

```typescript
@ApiProperty({
  description: 'Total portfolio value in USD at the time of snapshot creation',
  example: 15420.50,
})
totalValueUsd: number;
```

### 4. Error Documentation

Document all possible error responses:

```typescript
@Post('verify')
@ApiResponse({ status: 200, description: 'Authentication successful' })
@ApiResponse({ status: 401, description: 'Invalid signature or expired challenge' })
@ApiResponse({ status: 400, description: 'Invalid public key format' })
async verifyChallenge() {}
```

### 5. Nested Objects

For complex nested structures:

```typescript
export class PortfolioSnapshotDto {
  @ApiProperty({ 
    description: 'Asset balances', 
    type: [AssetBalanceDto] 
  })
  assetBalances: AssetBalanceDto[];
}

export class AssetBalanceDto {
  @ApiProperty({ description: 'Asset code', example: 'XLM' })
  assetCode: string;
  
  @ApiProperty({ description: 'Asset amount', example: '1234.5678' })
  amount: string;
}
```

### 6. Enums

Document enum values clearly:

```typescript
@ApiProperty({
  description: 'The time window identifier',
  enum: ['24h', '7d', '30d'],
  example: '24h',
})
window: '24h' | '7d' | '30d';
```

## Common Patterns

### Paginated Responses

```typescript
export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'List of items', isArray: true })
  items: T[];

  @ApiProperty({ description: 'Total number of items', example: 150 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 15 })
  totalPages: number;
}
```

### Success/Error Responses

```typescript
@ApiResponse({
  status: 200,
  description: 'Operation successful',
  schema: {
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Operation completed' },
      data: { type: 'object' }
    }
  }
})
```

### Authentication Headers

For protected endpoints:

```typescript
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Get('protected')
async protectedEndpoint() {}
```

## Testing Documentation

### 1. Visual Inspection

Navigate to `http://localhost:3000/api/docs` and verify:
- All endpoints are listed
- Descriptions are clear and complete
- Examples are realistic
- Schemas are accurate

### 2. Try It Out

Use the Swagger UI "Try it out" feature to:
- Test request validation
- Verify response formats
- Check error handling

### 3. Export OpenAPI Spec

Download the spec from `/api/docs-json` and validate:
```bash
curl http://localhost:3000/api/docs-json > openapi.json
```

Use online validators like [Swagger Editor](https://editor.swagger.io/) to check for issues.

## Maintenance Checklist

When adding new endpoints:

- [ ] Add `@ApiTags()` to controller
- [ ] Add `@ApiOperation()` to endpoint
- [ ] Document all `@ApiResponse()` codes
- [ ] Add `@ApiQuery()` / `@ApiParam()` for parameters
- [ ] Add `@ApiProperty()` to all DTO fields
- [ ] Include realistic examples
- [ ] Add `@ApiBearerAuth()` if authentication required
- [ ] Test in Swagger UI
- [ ] Update API documentation guide if needed

## Troubleshooting

### Issue: DTO not showing in Swagger

**Solution**: Ensure the DTO is used as a type in `@ApiResponse()`:

```typescript
@ApiResponse({ status: 200, type: MyDto })
```

### Issue: Properties missing from schema

**Solution**: Add `@ApiProperty()` to all properties, even optional ones:

```typescript
@ApiPropertyOptional()
optionalField?: string;
```

### Issue: Enum values not showing

**Solution**: Use the `enum` option:

```typescript
@ApiProperty({ enum: ['A', 'B', 'C'] })
status: 'A' | 'B' | 'C';
```

### Issue: Authentication not working in Swagger UI

**Solution**: Verify bearer auth is configured in main.ts and used correctly:

```typescript
// main.ts
.addBearerAuth({ ... }, 'JWT-auth')

// controller
@ApiBearerAuth('JWT-auth')
```

## Resources

- [NestJS Swagger Documentation](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
- [API Documentation Guide](./api-documentation-guide.md)

## Contributing

When contributing to the API:

1. Follow the patterns established in existing controllers
2. Document all new endpoints completely
3. Test documentation in Swagger UI
4. Update this guide if introducing new patterns
5. Include documentation in PR reviews

---

**Last Updated**: February 25, 2026
