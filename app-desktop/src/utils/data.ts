export function formatarDataUtc(iso: string): string {
  return new Date(iso + 'Z').toLocaleString('pt-BR')
}