export function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, latex: string) => `$$${latex}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, latex: string) => `$${latex}$`);
}
