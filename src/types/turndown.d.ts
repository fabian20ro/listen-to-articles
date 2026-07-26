declare module 'turndown' {
  export = TurndownService;
}

declare class TurndownService {
  constructor(options?: { headingStyle?: 'atx' | 'setext'; codeBlockStyle?: 'fenced' | 'indented' });
  turndown(html: string): string;
}
