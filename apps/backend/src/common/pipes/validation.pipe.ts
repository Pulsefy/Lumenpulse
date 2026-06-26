import {
  BadRequestException,
  ValidationPipe as NestValidationPipe,
  ValidationError,
  Optional,
  PipeTransform,
} from '@nestjs/common';
import { ErrorCode } from '../enums/error-code.enum';
import { ErrorDetail } from '../../interfaces/error-response.interface';

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
