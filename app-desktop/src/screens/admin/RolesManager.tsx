import { useState, useEffect } from 'react'
import type { CargoResumo, NivelPermissao } from '../../types'
import { Plus, Trash2, Edit2 } from 'lucide-react'

const API_URL = 'http://localhost:8080/api/admin'

export default function RolesManager({ token }: { token: string }) {
  const [cargos, setCargos] = useState<CargoResumo[]>([])
  const [permissoes, setPermissoes] = useState<NivelPermissao[]>([])
  const [loading, setLoading] = useState(true)

  const [novoCargoNome, setNovoCargoNome] = useState('')
  const [novoCargoPermissao, setNovoCargoPermissao] = useState<number>(1)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDados()
  }, [])

  async function fetchDados() {
    try {
      setLoading(true)
      const [resCargos, resPermissoes] = await Promise.all([
        fetch(`${API_URL}/cargos`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/cargos/permissoes`, { headers: { Authorization: `Bearer ${token}` } })
      ])
      
      if (resCargos.ok) setCargos(await resCargos.json())
      if (resPermissoes.ok) setPermissoes(await resPermissoes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(`${API_URL}/cargos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ cargo: novoCargoNome, idPermissao: novoCargoPermissao })
      })

      if (res.ok) {
        setNovoCargoNome('')
        fetchDados()
      } else {
        const data = await res.json()
        setError(data.erro || 'Erro ao criar cargo')
      }
    } catch (e) {
      setError('Erro de conexão')
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Deseja realmente excluir este cargo?')) return
    try {
      const res = await fetch(`${API_URL}/cargos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchDados()
      } else {
        const data = await res.json()
        alert(data.erro || 'Erro ao excluir')
      }
    } catch (e) {
      alert('Erro de conexão')
    }
  }

  if (loading) return <div className="text-slate-500">Carregando...</div>

  return (
    <div className="space-y-6">
      {/* Formulário Criar */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <h2 className="text-lg font-medium text-slate-900 mb-4">Adicionar Novo Cargo</h2>
        <form onSubmit={handleCreate} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Cargo</label>
            <input
              type="text"
              required
              value={novoCargoNome}
              onChange={e => setNovoCargoNome(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Desenvolvedor Pleno"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Permissão</label>
            <select
              value={novoCargoPermissao}
              onChange={e => setNovoCargoPermissao(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {permissoes.map(p => (
                <option key={p.id} value={p.id}>
                  Nível {p.nivel} - {p.descricao}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Adicionar
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Lista */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 font-medium">ID</th>
              <th className="px-6 py-3 font-medium">Cargo</th>
              <th className="px-6 py-3 font-medium">Nível</th>
              <th className="px-6 py-3 font-medium">Descrição</th>
              <th className="px-6 py-3 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargos.map(cargo => (
              <tr key={cargo.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">{cargo.id}</td>
                <td className="px-6 py-4 font-medium text-slate-900">{cargo.cargo}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Lvl {cargo.nivel}
                  </span>
                </td>
                <td className="px-6 py-4 truncate max-w-xs" title={cargo.descricao}>
                  {cargo.descricao}
                </td>
                <td className="px-6 py-4 text-right space-x-2">
                  {/* TODO: Implementar Edit Modal */}
                  <button className="text-slate-400 hover:text-blue-600 transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(cargo.id)}
                    className="text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {cargos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  Nenhum cargo encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
