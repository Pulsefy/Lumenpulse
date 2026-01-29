import { FileValidatorContext } from './file-validator-context.interface';
import { FileValidator } from './file-validator.interface';
import { IFile } from './interfaces';
type FileTypeValidatorContext = FileValidatorContext<Omit<FileTypeValidatorOptions, 'errorMessage'>>;
export type FileTypeValidatorOptions = {
    /**
     * Expected file type(s) for validation. Can be a string (MIME type)
     * or a regular expression to match multiple types.
     *
     * @example
     * // Match a single MIME type
     * fileType: 'image/png'
     *
     * @example
     * // Match multiple types using RegExp
     * fileType: /^image\/(png|jpeg)$/
     */
    fileType: string | RegExp;
    /**
     * Custom error message displayed when file type validation fails
     * Can be provided as a static string, or as a factory function
     * that receives the validation context (file and validator configuration)
     * and returns a dynamic error message.
     *
     * @example
     * // Static message
     * new FileTypeValidator({ fileType: 'image/png', errorMessage: 'Only PNG allowed' })
     *
     * @example
     * // Dynamic message based on file object and validator configuration
     * new FileTypeValidator({
     *   fileType: 'image/png',
     *   errorMessage: ctx => `Received file type '${ctx.file?.mimetype}', but expected '${ctx.config.fileType}'`
     * })
     */
    errorMessage?: string | ((ctx: FileTypeValidatorContext) => string);
    /**
     * If `true`, the validator will skip the magic numbers validation.
     * This can be useful when you can't identify some files as there are no common magic numbers available for some file types.
     * @default false
     */
    skipMagicNumbersValidation?: boolean;
    /**
     * If `true`, and magic number check fails, fallback to mimetype comparison.
     * @default false
     */
    fallbackToMimetype?: boolean;
};
/**
 * Defines the built-in FileTypeValidator. It validates incoming files by examining
 * their magic numbers using the file-type package, providing more reliable file type validation
 * than just checking the mimetype string.
 *
 * @see [File Validators](https://docs.nestjs.com/techniques/file-upload#validators)
 *
 * @publicApi
 */
export declare class FileTypeValidator extends FileValidator<FileTypeValidatorOptions, IFile> {
    buildErrorMessage(file?: IFile): string;
    isValid(file?: IFile): Promise<boolean>;
}
export {};
