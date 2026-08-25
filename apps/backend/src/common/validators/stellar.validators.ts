import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates that a string is a valid Stellar public key (G...)
 */
@ValidatorConstraint({ async: false })
export class IsStellarAddressConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    try {
      return StrKey.isValidEd25519PublicKey(value);
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Stellar public key (G...)`;
  }
}

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarAddressConstraint,
    });
  };
}

/**
 * Validates that a string is a valid Stellar contract ID (C...)
 */
@ValidatorConstraint({ async: false })
export class IsContractIdConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    try {
      return StrKey.isValidContract(value);
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Stellar contract ID (C...)`;
  }
}

export function IsContractId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsContractIdConstraint,
    });
  };
}

/**
 * Validates that a string is a valid base64-encoded XDR
 */
@ValidatorConstraint({ async: false })
export class IsBase64XdrConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    // Check if it's valid base64 and at least 8 bytes
    try {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length >= 8;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid base64-encoded XDR`;
  }
}

export function IsBase64Xdr(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsBase64XdrConstraint,
    });
  };
}

/**
 * Validates that a string is a valid amount string (positive integer without decimals)
 */
@ValidatorConstraint({ async: false })
export class IsStroopsAmountConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') return false;
    // Must be a positive integer without decimals
    return /^[1-9]\d*$/.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid stroops amount (positive integer string)`;
  }
}

export function IsStroopsAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStroopsAmountConstraint,
    });
  };
}
