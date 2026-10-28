export const API_URL = 'http://localhost:8080'
export const TELEMETRIA_API_URL = 'http://localhost:8081'
export const TELEMETRIA_WS_URL = 'ws://localhost:8081'

export function formatarDataUtc(iso: string): string {
  return new Date(iso + 'Z').toLocaleString('pt-BR')
}
