import { getActiveEnvironment, getEnvironmentConfig, setActiveEnvironment } from '../config';

describe('config', () => {
  it('has a default testnet environment', () => {
    expect(getActiveEnvironment()).toBe('testnet');
    expect(getEnvironmentConfig().stellarNetwork).toBe('testnet');
  });

  it('allows switching the active environment', () => {
    setActiveEnvironment('mainnet');
    expect(getActiveEnvironment()).toBe('mainnet');
    expect(getEnvironmentConfig().explorerNetwork).toBe('public');

    setActiveEnvironment('testnet');
  });
});
