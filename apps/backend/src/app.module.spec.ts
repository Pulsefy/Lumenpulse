import { AppModule } from './app.module';

describe('AppModule controller registration invariants', () => {
  it('does not register any controllers matching test* or Test*', () => {
    // Reflect metadata for controllers registered in AppModule
    const controllers =
      (Reflect.getMetadata('controllers', AppModule) as
        | Array<new (...args: any[]) => any>
        | undefined) ?? [];

    const testControllers = controllers
      .map((controller) => controller?.name ?? String(controller))
      .filter((name) => /^test/i.test(name));

    expect(testControllers).toEqual([]);
  });
});
