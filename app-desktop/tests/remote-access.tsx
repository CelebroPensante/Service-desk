import { createRoot } from 'react-dom/client'
import AcessoRemoto from '../src/components/chamados/AcessoRemoto'
import '../src/index.css'
import type { Chamado } from '../src/types'
const owner = new URLSearchParams(location.search).get('role') === 'owner'
const chamado = { id: 10, idUsuario: 1, dataResolucao: null } as Chamado
createRoot(document.getElementById('root')!).render(<AcessoRemoto chamado={chamado} userId={owner ? 1 : 2} level={owner ? 1 : 2} token={owner ? 'owner' : 'tech'} />)
