"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaxFileSizeValidator = void 0;
const file_validator_interface_1 = require("./file-validator.interface");
/**
 * Defines the built-in MaxSize File Validator
 *
 * @see [File Validators](https://docs.nestjs.com/techniques/file-upload#file-validation)
 *
 * @publicApi
 */
class MaxFileSizeValidator extends file_validator_interface_1.FileValidator {
    buildErrorMessage(file) {
        const { errorMessage, message, ...config } = this.validationOptions;
        if (errorMessage) {
            return typeof errorMessage === 'function'
                ? errorMessage({ file, config })
                : errorMessage;
        }
        if (message) {
            return typeof message === 'function'
                ? message(this.validationOptions.maxSize)
                : message;
        }
        if (file?.size) {
            return `Validation failed (current file size is ${file.size}, expected size is less than ${this.validationOptions.maxSize})`;
        }
        return `Validation failed (expected size is less than ${this.validationOptions.maxSize})`;
    }
    isValid(file) {
        if (!this.validationOptions || !file) {
            return true;
        }
        return 'size' in file && file.size < this.validationOptions.maxSize;
    }
}
exports.MaxFileSizeValidator = MaxFileSizeValidator;
