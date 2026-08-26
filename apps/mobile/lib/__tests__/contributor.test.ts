import { contributorApi, getTierColor, getVerificationStatusColor, getVerificationStatusLabel } from '../contributor';

describe('contributor helpers', () => {
  it('maps each contributor tier to the expected color', () => {
    expect(getTierColor('Core')).toBe('#8b5cf6');
    expect(getTierColor('Architect')).toBe('#3b82f6');
    expect(getTierColor('Builder')).toBe('#10b981');
    expect(getTierColor('Novice')).toBe('#f59e0b');
    expect(getTierColor(undefined)).toBe('#f59e0b');
  });

  it('maps verification states to their colors and labels', () => {
    expect(getVerificationStatusColor('VERIFIED')).toBe('#10b981');
    expect(getVerificationStatusLabel('VERIFIED')).toBe('Verified Contributor');
    expect(getVerificationStatusColor('PENDING')).toBe('#f59e0b');
    expect(getVerificationStatusLabel('PENDING')).toBe('Pending Review');
    expect(getVerificationStatusColor('UNREGISTERED')).toBe('#94a3b8');
    expect(getVerificationStatusLabel('UNREGISTERED')).toBe('Unregistered Identity');
  });

  it('exposes the expected contributor API methods', () => {
    expect(typeof contributorApi.getByAddress).toBe('function');
    expect(typeof contributorApi.getByGithub).toBe('function');
    expect(typeof contributorApi.getReputation).toBe('function');
    expect(typeof contributorApi.getVerificationState).toBe('function');
  });
});
