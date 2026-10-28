import * as vscode from 'vscode';

//definisanaje interface-a
export interface Settings {
  enabled: boolean;
  serverUrl: string;
  delay: number;
  maxTokens: number;
  temperature: number;
  multiline: boolean;
  maxPrefixChars: number;
  maxSuffixChars: number;
  disabledLanguages: string[];
  serverBackend: 'auto' | 'cpu' | 'cuda';
}

export function getSettings(): Settings {
  const c = vscode.workspace.getConfiguration('fimAutocomplete');
  return {
    enabled: c.get<boolean>('enabled', true),
    serverUrl: c.get<string>('serverUrl', 'http://127.0.0.1:8080').replace(/\/$/, ''),
    delay: c.get<number>('delay', 300),
    maxTokens: c.get<number>('maxTokens', 128),
    temperature: c.get<number>('temperature', 0.2),
    multiline: c.get<boolean>('multiline', true),
    maxPrefixChars: c.get<number>('maxPrefixChars', 4000),
    maxSuffixChars: c.get<number>('maxSuffixChars', 2000),
    disabledLanguages: c.get<string[]>('disabledLanguages', []),
    serverBackend: c.get<'auto' | 'cpu' | 'cuda'>('serverBackend', 'auto'),
  };
}
