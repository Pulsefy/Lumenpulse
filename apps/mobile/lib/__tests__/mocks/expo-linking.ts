export const createURL = (path: string) => `https://lumenpulse.app/${path}`;
export const openURL = async (url: string) => Promise.resolve(true);
export const addEventListener = () => ({ remove: () => {} });
