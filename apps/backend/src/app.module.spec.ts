import { AppModule } from './app.module';

describe('AppModule registration guard', () => {
  it('prevents any controllers named test* from being registered in app.module.ts', () => {
    // Retrieve registered controllers metadata from AppModule
    const controllers =
      (Reflect.getMetadata('controllers', AppModule) as unknown[]) || [];

    const testControllers = controllers.filter((ctrl: any) => {
      const name = typeof ctrl === 'function' ? ctrl.name : String(ctrl);
      return name.toLowerCase().startsWith('test');
    });

    expect(testControllers).toEqual([]);
  });
});
