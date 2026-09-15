import { useState, useEffect } from 'react'
import type { UsuarioResumo, CargoResumo } from '../../types'
import { UserCheck } from 'lucide-react'

const API_URL = 'http://localhost:8080/api/admin'

export default function UsersManager({ token }: { token: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioResumo[]>([])
  const [cargos, setCargos] = useState<CargoResumo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDados()
  }, [])

  async function fetchDados() {
    try {
      setLoading(true)
      const [resUsers, resCargos] = await Promise.all([
        fetch(`${API_URL}/usuarios`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/cargos`, { headers: { Authorization: `Bearer ${token}` } })
      ])
      
      if (resUsers.ok) setUsuarios(await resUsers.json())
      if (resCargos.ok) setCargos(await resCargos.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleAtribuirCargo(idUsuario: number, novoIdCargo: number) {
    try {
      const res = await fetch(`${API_URL}/usuarios/${idUsuario}/cargo`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ idCargo: novoIdCargo })
      })

      if (res.ok) {
        // Atualiza localmente para não precisar refazer o fetch inteiro
        setUsuarios(prev => prev.map(u => 
          u.id === idUsuario 
            ? { ...u, idCargo: novoIdCargo, cargo: cargos.find(c => c.id === novoIdCargo)?.cargo || u.cargo }
            : u
        ))
      } else {
        const data = await res.json()
        alert(data.erro || 'Erro ao atribuir cargo')
      }
    } catch (e) {
      alert('Erro de conexão')
    }
  }

  if (loading) return <div className="text-slate-500">Carregando...</div>

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <table className="w-full text-left text-sm text-slate-600">
        <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
          <tr>
            <th className="px-6 py-3 font-medium">ID</th>
            <th className="px-6 py-3 font-medium">Usuário</th>
            <th className="px-6 py-3 font-medium">Email</th>
            <th className="px-6 py-3 font-medium">Status</th>
            <th className="px-6 py-3 font-medium">Atribuir Cargo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {usuarios.map(user => (
            <tr key={user.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-6 py-4">{user.id}</td>
              <td className="px-6 py-4 font-medium text-slate-900">{user.nome}</td>
              <td className="px-6 py-4">{user.email}</td>
              <td className="px-6 py-4">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  user.ativo ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                }`}>
                  {user.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-slate-400" />
                  <select
                    value={user.idCargo}
                    onChange={(e) => handleAtribuirCargo(user.id, Number(e.target.value))}
                    className="pl-2 pr-8 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {cargos.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.cargo} (Nível {c.nivel})
                      </option>
                    ))}
                  </select>
                </div>
              </td>
            </tr>
          ))}
          {usuarios.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                Nenhum usuário encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
