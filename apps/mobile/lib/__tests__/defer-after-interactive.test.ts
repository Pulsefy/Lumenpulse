import { scheduleAfterInteractive } from '../defer-after-interactive';

describe('scheduleAfterInteractive', () => {
  it('runs work via InteractionManager', () => {
    const work = jest.fn();
    const task = scheduleAfterInteractive(work);
    expect(work).toHaveBeenCalled();
    task.cancel();
  });
});
