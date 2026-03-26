/**
 * Example DTOs demonstrating the new validation and sanitization features.
 * Use these as templates when creating new DTOs.
 */

import {
  IsString,
  IsEmail,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsUrl,
  IsDateString,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Sanitize, CustomSanitizer } from './decorators/sanitize.decorator';

/**
 * Example 1: Basic Registration DTO
 * Demonstrates:
 * - Basic validation decorators
 * - Automatic sanitization (via global pipe)
 * - Min/Max length constraints
 */
export class ExampleRegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  // Apply explicit sanitization if needed in addition to global pipe
  @Sanitize()
  bio?: string;
}

/**
 * Example 2: Article Creation with Nested Objects
 * Demonstrates:
 * - Nested validation
 * - Custom sanitization decorators
 * - Optional fields
 */
export class ExampleCreateArticleDto {
  @Sanitize()
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(300)
  title: string;

  @Sanitize()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  content: string;

  @IsUrl()
  @IsNotEmpty()
  sourceUrl: string;

  @IsDateString()
  @IsNotEmpty()
  publishedAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sentimentScore?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

/**
 * Example 3: Search Query with Case-Insensitive Sanitization
 * Demonstrates:
 * - Custom sanitizer for specific behavior
 * - Combined with validation
 */
export class ExampleSearchDto {
  @CustomSanitizer((value) => value.toLowerCase().trim())
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

/**
 * Example 4: Nested DTO with Arrays
 * Demonstrates:
 * - Nested object validation
 * - Array handling
 * - Nested sanitization
 */
export class ExampleMetadataDto {
  @Sanitize()
  @IsString()
  @IsNotEmpty()
  key: string;

  @Sanitize()
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class ExampleMetadataArrayDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExampleMetadataDto)
  metadata: ExampleMetadataDto[];
}

/**
 * Example 5: Updating an Existing DTO to Add Sanitization
 *
 * BEFORE:
 * export class LoginDto {
 *   @IsEmail()
 *   @IsNotEmpty()
 *   email: string;
 *
 *   @IsString()
 *   @IsNotEmpty()
 *   @MinLength(6)
 *   password: string;
 * }
 *
 * AFTER: Add @Sanitize() decorators where needed
 */
export class ExampleUpdatedLoginDto {
  @Sanitize()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string; // Usually passwords aren't sanitized
}

/**
 * Migration Guide:
 *
 * 1. ADD @Sanitize() to string fields that contain user-generated content
 * 2. OPTIONAL: Use specific sanitizers like @SanitizeTrim() or @CustomSanitizer()
 * 3. NO CHANGES needed for:
 *    - Numeric fields
 *    - Boolean fields
 *    - Email/URL fields
 *    - Date fields
 * 4. ENSURE validation still works after sanitization
 *    - Example: If you trim, @MinLength counts after trim
 * 5. TEST the updated DTOs with invalid inputs
 *
 * This update is backward compatible - existing DTOs will automatically
 * benefi from the global sanitization pipe without changes.
 */
