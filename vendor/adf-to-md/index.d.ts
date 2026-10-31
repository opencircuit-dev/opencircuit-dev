declare const converter: {
  convert(document: object): { result: string; warnings: Set<string> };
  validate(document: object): void;
};

export = converter;
