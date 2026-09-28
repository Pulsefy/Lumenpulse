import { MessageTemplateRenderError } from './message-template.errors';

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const VALID_PLACEHOLDER_PATTERN = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g;

export interface RenderTemplateFieldResult {
  rendered: string;
  variablesUsed: string[];
}

/**
 * Renders a single template string, substituting `{{variable}}` placeholders.
 * Fails fast on malformed syntax or missing required variables.
 */
export function renderTemplateField(
  template: string,
  variables: Record<string, string | number>,
  requiredVariables: string[],
  fieldLabel: string,
): RenderTemplateFieldResult {
  validateTemplateSyntax(template, fieldLabel);

  const variablesUsed = extractPlaceholderNames(template);

  for (const name of requiredVariables) {
    if (!(name in variables)) {
      throw new MessageTemplateRenderError(
        `Missing required variable "${name}" for ${fieldLabel}`,
        'MISSING_VARIABLE',
        { field: fieldLabel, variable: name },
      );
    }
  }

  for (const name of variablesUsed) {
    if (!(name in variables)) {
      throw new MessageTemplateRenderError(
        `Missing variable "${name}" referenced in ${fieldLabel}`,
        'MISSING_VARIABLE',
        { field: fieldLabel, variable: name },
      );
    }
  }

  const rendered = template.replace(
    PLACEHOLDER_PATTERN,
    (_match, name: string) => {
      const value = variables[name];
      if (value === null || value === undefined) {
        throw new MessageTemplateRenderError(
          `Variable "${name}" is null or undefined in ${fieldLabel}`,
          'INVALID_VARIABLE',
          { field: fieldLabel, variable: name },
        );
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new MessageTemplateRenderError(
          `Variable "${name}" is not a finite number in ${fieldLabel}`,
          'INVALID_VARIABLE',
          { field: fieldLabel, variable: name },
        );
      }
      return String(value);
    },
  );

  return { rendered, variablesUsed };
}

function validateTemplateSyntax(template: string, fieldLabel: string): void {
  let openIndex = template.indexOf('{{');
  while (openIndex !== -1) {
    const closeIndex = template.indexOf('}}', openIndex);
    if (closeIndex === -1) {
      throw new MessageTemplateRenderError(
        `Unclosed "{{" placeholder in ${fieldLabel}`,
        'MALFORMED_TEMPLATE',
        { field: fieldLabel },
      );
    }

    const inner = template.slice(openIndex + 2, closeIndex);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(inner)) {
      throw new MessageTemplateRenderError(
        `Malformed placeholder "{{${inner}}}" in ${fieldLabel}. Use {{variableName}} with letters, numbers, or underscores.`,
        'MALFORMED_TEMPLATE',
        { field: fieldLabel, placeholder: inner },
      );
    }

    openIndex = template.indexOf('{{', closeIndex + 2);
  }

  const stripped = template.replace(VALID_PLACEHOLDER_PATTERN, '');
  if (stripped.includes('{{') || stripped.includes('}}')) {
    throw new MessageTemplateRenderError(
      `Malformed placeholder syntax in ${fieldLabel}`,
      'MALFORMED_TEMPLATE',
      { field: fieldLabel },
    );
  }
}

export function extractPlaceholderNames(template: string): string[] {
  const names = new Set<string>();
  const matches = template.matchAll(PLACEHOLDER_PATTERN);
  for (const match of matches) {
    names.add(match[1]);
  }
  return [...names];
}
