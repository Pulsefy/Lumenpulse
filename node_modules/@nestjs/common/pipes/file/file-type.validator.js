"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileTypeValidator = void 0;
const url_1 = require("url");
const logger_service_1 = require("../../services/logger.service");
const file_validator_interface_1 = require("./file-validator.interface");
const load_esm_1 = require("load-esm");
const logger = new logger_service_1.Logger('FileTypeValidator');
/**
 * Defines the built-in FileTypeValidator. It validates incoming files by examining
 * their magic numbers using the file-type package, providing more reliable file type validation
 * than just checking the mimetype string.
 *
 * @see [File Validators](https://docs.nestjs.com/techniques/file-upload#validators)
 *
 * @publicApi
 */
class FileTypeValidator extends file_validator_interface_1.FileValidator {
    buildErrorMessage(file) {
        const { errorMessage, ...config } = this.validationOptions;
        if (errorMessage) {
            return typeof errorMessage === 'function'
                ? errorMessage({ file, config })
                : errorMessage;
        }
        if (file?.mimetype) {
            const baseMessage = `Validation failed (current file type is ${file.mimetype}, expected type is ${this.validationOptions.fileType})`;
            /**
             * If fallbackToMimetype is enabled, this means the validator failed to detect the file type
             * via magic number inspection (e.g. due to an unknown or too short buffer),
             * and instead used the mimetype string provided by the client as a fallback.
             *
             * This message clarifies that fallback logic was used, in case users rely on file signatures.
             */
            if (this.validationOptions.fallbackToMimetype) {
                return `${baseMessage} - magic number detection failed, used mimetype fallback`;
            }
            return baseMessage;
        }
        return `Validation failed (expected type is ${this.validationOptions.fileType})`;
    }
    async isValid(file) {
        if (!this.validationOptions) {
            return true;
        }
        const isFileValid = !!file && 'mimetype' in file;
        // Skip magic number validation if set
        if (this.validationOptions.skipMagicNumbersValidation) {
            return (isFileValid && !!file.mimetype.match(this.validationOptions.fileType));
        }
        if (!isFileValid)
            return false;
        if (!file.buffer) {
            if (this.validationOptions.fallbackToMimetype) {
                return !!file.mimetype.match(this.validationOptions.fileType);
            }
            return false;
        }
        try {
            let fileTypeModule;
            try {
                const resolvedPath = require.resolve('file-type');
                fileTypeModule = (0, url_1.pathToFileURL)(resolvedPath).href;
            }
            catch {
                fileTypeModule = 'file-type';
            }
            const { fileTypeFromBuffer } = await (0, load_esm_1.loadEsm)(fileTypeModule);
            const fileType = await fileTypeFromBuffer(file.buffer);
            if (fileType) {
                // Match detected mime type against allowed type
                return !!fileType.mime.match(this.validationOptions.fileType);
            }
            /**
             * Fallback logic: If file-type cannot detect magic number (e.g. file too small),
             * Optionally fall back to mimetype string for compatibility.
             * This is useful for plain text, CSVs, or files without recognizable signatures.
             */
            if (this.validationOptions.fallbackToMimetype) {
                return !!file.mimetype.match(this.validationOptions.fileType);
            }
            return false;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Check for common ESM loading issues
            if (errorMessage.includes('ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') ||
                errorMessage.includes('Cannot find module') ||
                errorMessage.includes('ERR_MODULE_NOT_FOUND')) {
                logger.warn(`Failed to load the "file-type" package for magic number validation. ` +
                    `If you are using Jest, run it with NODE_OPTIONS="--experimental-vm-modules". ` +
                    `Error: ${errorMessage}`);
            }
            // Fallback to mimetype if enabled
            if (this.validationOptions.fallbackToMimetype) {
                return !!file.mimetype.match(this.validationOptions.fileType);
            }
            return false;
        }
    }
}
exports.FileTypeValidator = FileTypeValidator;
