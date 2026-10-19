import {
  BadRequestException,
  ArgumentMetadata,
  ValidationPipe as NestValidationPipe,
  ValidationError,
  Optional,
  PipeTransform,
} from '@nestjs/common';
import { ErrorCode } from '../enums/error-code.enum';
import { ErrorDetail } from '../../interfaces/error-response.interface';
import {
  MAX_REQUEST_ARRAY_LENGTH,
  MAX_REQUEST_NESTING_DEPTH,
} from '../constants/request.constants';

/**
 * Global validation pipe with enhanced security and error formatting.
 * - Whitelist: Only allows properties defined in the DTO
 * - forbidNonWhitelisted: Throws error if extra properties are provided
 * - transform: Automatically transforms payloads to DTO instances and applies type coercion
 * - transformOptions: To convert primitive objects to instances of their respective classes
 * - stopAtFirstError: Stops validation on first error (performance optimization)
 */
export class CustomValidationPipe
  extends NestValidationPipe
  implements PipeTransform
{
  constructor(@Optional() private readonly sanitizer?: (value: any) => any) {
    super({
      whitelist: true, // Strip properties that don't have any decorators
      forbidNonWhitelisted: true, // Throw errors when non-whitelisted properties are provided
      transform: true, // Automatically transform payloads to DTO class instances
      transformOptions: {
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      stopAtFirstError: false, // Collect all errors for better feedback
      exceptionFactory: (errors: ValidationError[]) => {
        const details = CustomValidationPipe.extractMessages(errors);

        return new BadRequestException({
          code: ErrorCode.SYS_VALIDATION_FAILED,
          message: 'Validation failed',
          details,
        });
      },
    });
  }

  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<any> {
    CustomValidationPipe.assertWithinRequestLimits(value);
    return super.transform(value, metadata);
  }

  private static assertWithinRequestLimits(value: unknown): void {
    const pending: Array<{ value: unknown; depth: number; field: string }> = [
      { value, depth: 0, field: 'request' },
    ];
    const visited = new WeakSet<object>();

    while (pending.length > 0) {
      const current = pending.pop()!;
      if (typeof current.value !== 'object' || current.value === null) {
        continue;
      }

      const depth = current.depth + 1;
      if (depth > MAX_REQUEST_NESTING_DEPTH) {
        CustomValidationPipe.throwLimitError(
          current.field,
          `Request nesting depth exceeds the maximum of ${MAX_REQUEST_NESTING_DEPTH}`,
        );
      }

      if (visited.has(current.value)) {
        continue;
      }
      visited.add(current.value);

      if (Array.isArray(current.value)) {
        if (current.value.length > MAX_REQUEST_ARRAY_LENGTH) {
          CustomValidationPipe.throwLimitError(
            current.field,
            `Array length exceeds the maximum of ${MAX_REQUEST_ARRAY_LENGTH}`,
          );
        }

        current.value.forEach((item, index) => {
          pending.push({
            value: item,
            depth,
            field: `${current.field}[${index}]`,
          });
        });
        continue;
      }

      Object.entries(current.value).forEach(([key, item]) => {
        pending.push({
          value: item,
          depth,
          field: `${current.field}.${key}`,
        });
      });
    }
  }

  private static throwLimitError(field: string, message: string): never {
    throw new BadRequestException({
      code: ErrorCode.SYS_VALIDATION_FAILED,
      message: 'Request validation limits exceeded',
      details: [{ field, message }],
    });
  }

  /**
   * Recursively extract error messages from ValidationError tree.
   */
  private static extractMessages(
    errors: ValidationError[],
    parentPath = '',
  ): ErrorDetail[] {
    const messages: ErrorDetail[] = [];

    for (const error of errors) {
      const path = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

      if (error.constraints) {
        // Add constraint messages with property path
        Object.values(error.constraints).forEach((constraint) => {
          messages.push({
            field: path,
            message: constraint,
          });
        });
      }

      if (error.children && error.children.length > 0) {
        // Recursively process nested objects
        messages.push(
          ...CustomValidationPipe.extractMessages(error.children, path),
        );
      }
    }

    return messages;
  }
}
