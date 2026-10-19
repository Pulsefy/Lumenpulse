export const getItemAsync = jest.fn(async () => null);
export const setItemAsync = jest.fn(async () => undefined);
export const deleteItemAsync = jest.fn(async () => undefined);

const SecureStore = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};

export default SecureStore;
