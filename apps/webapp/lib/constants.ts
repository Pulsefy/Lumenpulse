type DeepReadonly<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export function defineConstants<T extends Record<string, any>>(obj: T): DeepReadonly<T> {
  return obj as DeepReadonly<T>;
}

