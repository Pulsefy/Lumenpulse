export class UnavailabilityError extends Error {
  constructor(moduleName: string, propertyName: string) {
    super(`The method or property ${moduleName}.${propertyName} is not available on this platform.`);
  }
}
