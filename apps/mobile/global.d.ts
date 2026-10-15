declare global {
  var __DEV__: boolean;
  namespace NodeJS {
    interface Global {
      __DEV__: boolean;
    }
  }
  interface globalThis {
    __DEV__: boolean;
  }
}

export {};
