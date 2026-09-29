export const hasHardwareAsync = jest.fn(async () => true);
export const supportedAuthenticationTypesAsync = jest.fn(async () => [1]);
export const isEnrolledAsync = jest.fn(async () => true);
export const authenticateAsync = jest.fn(async () => ({ success: true }));

const LocalAuthentication = {
  hasHardwareAsync,
  supportedAuthenticationTypesAsync,
  isEnrolledAsync,
  authenticateAsync,
};

export default LocalAuthentication;
