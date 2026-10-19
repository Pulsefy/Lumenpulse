import { ArgumentMetadata } from '@nestjs/common';
import { CreateVerificationRequestDto } from '../../verification-requests/dto/verification-request.dto';
import { VerificationRequestTargetType } from '../../verification-requests/entities/verification-request.entity';
import { CustomValidationPipe } from './validation.pipe';
import {
  MAX_EVIDENCE_LENGTH,
  MAX_REQUEST_ARRAY_LENGTH,
  MAX_REQUEST_NESTING_DEPTH,
} from '../constants/request.constants';

describe('CustomValidationPipe request limits', () => {
  const pipe = new CustomValidationPipe();
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: Object,
    data: '',
  };

  it('accepts an array at the maximum length', async () => {
    const value = { items: Array.from({ length: MAX_REQUEST_ARRAY_LENGTH }) };

    await expect(pipe.transform(value, metadata)).resolves.toBe(value);
  });

  it('rejects an array over the maximum length', async () => {
    const value = {
      items: Array.from({ length: MAX_REQUEST_ARRAY_LENGTH + 1 }),
    };

    await expect(pipe.transform(value, metadata)).rejects.toMatchObject({
      status: 400,
      response: {
        details: [
          {
            field: 'request.items',
            message: `Array length exceeds the maximum of ${MAX_REQUEST_ARRAY_LENGTH}`,
          },
        ],
      },
    });
  });

  it('accepts objects at the maximum nesting depth', async () => {
    let value: Record<string, unknown> = {};
    for (let depth = 1; depth < MAX_REQUEST_NESTING_DEPTH; depth += 1) {
      value = { nested: value };
    }

    await expect(pipe.transform(value, metadata)).resolves.toBe(value);
  });

  it('rejects objects over the maximum nesting depth', async () => {
    let value: Record<string, unknown> = {};
    for (let depth = 0; depth < MAX_REQUEST_NESTING_DEPTH; depth += 1) {
      value = { nested: value };
    }

    await expect(pipe.transform(value, metadata)).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Request validation limits exceeded',
      },
    });
  });

  it('accepts evidence at the maximum character length', async () => {
    const value = {
      targetType: VerificationRequestTargetType.PROJECT,
      targetId: 'project-1',
      evidence: 'x'.repeat(MAX_EVIDENCE_LENGTH),
    };

    await expect(
      pipe.transform(value, {
        ...metadata,
        metatype: CreateVerificationRequestDto,
      }),
    ).resolves.toMatchObject(value);
  });

  it('rejects evidence over the maximum character length', async () => {
    const value = {
      targetType: VerificationRequestTargetType.PROJECT,
      targetId: 'project-1',
      evidence: 'x'.repeat(MAX_EVIDENCE_LENGTH + 1),
    };

    await expect(
      pipe.transform(value, {
        ...metadata,
        metatype: CreateVerificationRequestDto,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
