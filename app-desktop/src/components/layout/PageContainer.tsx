import type { ReactNode } from 'react'

interface PageContainerProps {
  titulo: string
  subtitulo: string
  children: ReactNode
}

// Cabeçalho + largura padrão das telas de gestão
function PageContainer({ titulo, subtitulo, children }: PageContainerProps) {
  return (
    <div className="mx-auto w-full max-w-6xl px-10 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{titulo}</h1>
      <p className="mt-1 text-sm text-slate-600">{subtitulo}</p>
      <div className="mt-8">{children}</div>
    </div>
  )
}

export default PageContainer