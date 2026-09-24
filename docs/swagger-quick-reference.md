# Swagger Quick Reference Card

## 🚀 Quick Start

### Access Documentation
```
Development: http://localhost:3000/api/docs
Production:  https://api.lumenpulse.io/api/docs
```

### Test Endpoints
1. Click "Authorize" button
2. Enter: `Bearer <your_jwt_token>`
3. Click any endpoint → "Try it out"
4. Fill parameters → "Execute"

## 📝 Common Decorators

### Controller Level
```typescript
@ApiTags('module-name')              // Group endpoints
@ApiBearerAuth('JWT-auth')           // Require authentication
@Controller('path')
export class MyController {}
```

### Endpoint Level
```typescript
@ApiOperation({ summary: 'Short description' })
@ApiResponse({ status: 200, description: 'Success', type: MyDto })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiQuery({ name: 'param', required: false, type: Number })
@ApiParam({ name: 'id', type: String })
```

### DTO Level
```typescript
export class MyDto {
  @ApiProperty({
    description: 'Field description',
    example: 'example value',
  })
  field: string;

  @ApiPropertyOptional({
    description: 'Optional field',
    example: 'example',
  })
  optional?: string;
}
```

## 🎯 Checklist for New Endpoints

- [ ] Add `@ApiTags()` to controller
- [ ] Add `@ApiOperation()` to method
- [ ] Document success response (200/201)
- [ ] Document error responses (400/401/404)
- [ ] Add `@ApiQuery()` for query params
- [ ] Add `@ApiParam()` for path params
- [ ] Add `@ApiProperty()` to all DTO fields
- [ ] Include realistic examples
- [ ] Add `@ApiBearerAuth()` if protected
- [ ] Test in Swagger UI

## 📚 Documentation Files

| File | Purpose | Audience |
|------|---------|----------|
| `api-documentation-guide.md` | Complete API reference | Frontend/Mobile devs |
| `swagger-implementation-guide.md` | Implementation details | Backend devs |
| `swagger-documentation-summary.md` | Status & metrics | All |

## 🔧 Common Patterns

### Paginated Endpoint
```typescript
@Get()
@ApiQuery({ name: 'page', required: false, type: Number })
@ApiQuery({ name: 'limit', required: false, type: Number })
@ApiResponse({ status: 200, type: PaginatedResponseDto })
async findAll(@Query() query: PaginationDto) {}
```

### Protected Endpoint
```typescript
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@Get('protected')
@ApiResponse({ status: 401, description: 'Unauthorized' })
async protectedRoute() {}
```

### Error Responses
```typescript
@ApiResponse({ status: 400, description: 'Bad Request' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 404, description: 'Not Found' })
@ApiResponse({ status: 500, description: 'Internal Server Error' })
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| DTO not showing | Add `type: MyDto` to `@ApiResponse()` |
| Properties missing | Add `@ApiProperty()` to all fields |
| Auth not working | Use `@ApiBearerAuth('JWT-auth')` |
| Enum not showing | Use `enum: ['A', 'B']` in `@ApiProperty()` |

## 📖 Resources

- [NestJS OpenAPI Docs](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)

## 🎓 Examples

### Complete Controller Example
```typescript
@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string) {}
}
```

### Complete DTO Example
```typescript
export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Display name',
    example: 'John Doe',
    maxLength: 255,
  })
  @IsOptional()
  @MaxLength(255)
  displayName?: string;
}
```

---

**Keep this card handy when adding new endpoints!**
