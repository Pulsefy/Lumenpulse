export enum BackgroundTaskStatus {
  Restricted = 1,
  Available = 2,
}

export enum BackgroundTaskResult {
  Success = 1,
  Failed = 2,
}

export const getStatusAsync = jest.fn(async () => BackgroundTaskStatus.Available);
export const registerTaskAsync = jest.fn(async () => undefined);
export const unregisterTaskAsync = jest.fn(async () => undefined);
