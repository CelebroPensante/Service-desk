export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'
export const TELEMETRIA_API_URL = import.meta.env.VITE_TELEMETRIA_API_URL || 'http://localhost:8081'
export const TELEMETRIA_WS_URL = TELEMETRIA_API_URL.replace(/^http/, 'ws')

export function formatarDataUtc(iso: string): string {
  return new Date(iso + 'Z').toLocaleString('pt-BR')
}
