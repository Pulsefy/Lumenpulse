import { renderTemplateField } from './message-template-renderer';
import { MessageTemplateRenderError } from './message-template.errors';

describe('renderTemplateField', () => {
  it('substitutes named variables', () => {
    const result = renderTemplateField(
      'Hello {{name}}, price is {{price}}.',
      { name: 'Ada', price: 1.5 },
      [],
      'test',
    );
    expect(result.rendered).toBe('Hello Ada, price is 1.5.');
    expect(result.variablesUsed).toEqual(['name', 'price']);
  });

  it('throws on missing referenced variable', () => {
    expect(() =>
      renderTemplateField('Hi {{name}}', {}, [], 'test'),
    ).toThrow(MessageTemplateRenderError);
  });

  it('throws on malformed placeholder', () => {
    expect(() =>
      renderTemplateField('Hi {{ bad }}', { bad: 'x' }, [], 'test'),
    ).toThrow(/Malformed placeholder/);
  });

  it('throws on unclosed placeholder', () => {
    expect(() => renderTemplateField('Hi {{name', { name: 'x' }, [], 'test')).toThrow(
      /Unclosed/,
    );
  });
});
