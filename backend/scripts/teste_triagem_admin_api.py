"""Teste da US-25 (gestão dos fluxos de triagem) contra a API rodando.

Uso (API no ar, migrations aplicadas, seed da árvore carregado):
    set ADMIN_EMAIL=seu_admin@...   (PowerShell: $env:ADMIN_EMAIL="...")
    set ADMIN_SENHA=sua_senha
    python scripts\\teste_triagem_admin_api.py

Precisa de um usuário com nível 5 (administrador). O script cria um cenário
"Impressora" de teste, exercita as regras e remove tudo no final.
Variáveis opcionais: API_URL (padrão http://localhost:8080) e INCLUIR_MOTOR=1
(confere também que o motor da triagem enxerga as mudanças; as triagens criadas
nesse teste impedem apagar os nós de teste, que ficam inativos).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("API_URL", "http://localhost:8080")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_SENHA = os.environ.get("ADMIN_SENHA")
INCLUIR_MOTOR = os.environ.get("INCLUIR_MOTOR") == "1"
falhas = 0


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def check(desc, got, esperado):
    global falhas
    ok = got == esperado
    falhas += 0 if ok else 1
    print(("OK    " if ok else "FALHOU"), desc, "" if ok else f"-> obtido {got!r}, esperado {esperado!r}")


def codigos(resp):
    return sorted({p["codigo"] for p in resp.get("problemas", resp.get("validacao", {}).get("problemas", []))})


if not ADMIN_EMAIL or not ADMIN_SENHA:
    sys.exit("Defina ADMIN_EMAIL e ADMIN_SENHA (usuário nível 5) antes de rodar.")

s, r = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "senha": ADMIN_SENHA})
if s != 200:
    sys.exit(f"Login do administrador falhou ({s}): {r}")
ta = r["token"]
nome_admin = r["usuario"]["nome"]

# usuário comum (nível padrão) para testar a permissão
s, r = req("POST", "/api/auth/register", {"nome": "Comum Teste", "email": "comum.teste@teste.com", "senha": "senha12345"})
if s not in (200, 201):
    s, r = req("POST", "/api/auth/login", {"email": "comum.teste@teste.com", "senha": "senha12345"})
tc = r["token"]

A = "/api/admin/triagem"

# ---------- Permissão ----------
s, _ = req("GET", A + "/arvore")
check("sem token é recusado", s, 401)
s, _ = req("GET", A + "/arvore", token=tc)
check("usuário comum não acessa a gestão (403)", s, 403)
s, _ = req("POST", A + "/nos", {"pergunta": "x", "tipoNo": "pergunta"}, tc)
check("usuário comum não cria nó (403)", s, 403)

# ---------- Estado inicial ----------
s, arv = req("GET", A + "/arvore", token=ta)
check("administrador lê a árvore", s, 200)
check("árvore inicial é válida", arv["validacao"]["valida"], True)
raiz_antiga = next(n["id"] for n in arv["nos"] if n["ehRaiz"])
qtd_nos, qtd_opcoes = len(arv["nos"]), sum(len(n["opcoes"]) for n in arv["nos"])

# ---------- Validação dos dados ----------
s, _ = req("POST", A + "/nos", {"pergunta": "   ", "tipoNo": "pergunta"}, ta)
check("pergunta vazia -> 400", s, 400)
s, _ = req("POST", A + "/nos", {"pergunta": "x", "tipoNo": "banana"}, ta)
check("tipo inválido -> 400", s, 400)
s, _ = req("POST", A + "/nos", {"pergunta": "x", "tipoNo": "sugestao_solucao"}, ta)
check("sugestão sem solução -> 400", s, 400)
s, _ = req("POST", A + "/nos", {"pergunta": "x", "tipoNo": "pergunta", "solucaoSugerida": "y"}, ta)
check("solução em nó que não é sugestão -> 400", s, 400)

# ---------- Trava de consistência: nó ativo órfão é recusado ----------
s, r = req("POST", A + "/nos", {"pergunta": "Órfão", "tipoNo": "etapa_final", "ativo": True}, ta)
check("nó ativo sem ligação (órfão) -> 422", (s, "NO_ORFAO" in codigos(r)), (422, True))
s, arv2 = req("GET", A + "/arvore", token=ta)
check("a alteração recusada foi desfeita", len(arv2["nos"]), qtd_nos)

# ---------- Novo cenário "Impressora" (rascunho) ----------
def novo_no(pergunta, tipo, solucao=None):
    corpo = {"pergunta": pergunta, "tipoNo": tipo}
    if solucao:
        corpo["solucaoSugerida"] = solucao
    s, r = req("POST", A + "/nos", corpo, ta)
    check(f"cria nó rascunho: {pergunta[:38]}", (s, r["validacao"]["valida"]), (201, True))
    return r["id"]


q = novo_no("Qual é o tipo do problema?", "pergunta")
n1 = novo_no("A impressora está ligada?", "pergunta")
s1 = novo_no("Sugestão: ligar a impressora", "sugestao_solucao",
             "Pressione o botão de energia.\nAguarde a inicialização.")
f1 = novo_no("Abrir chamado: impressora", "etapa_final")


def nova_opcao(origem, destino, texto):
    return req("POST", A + "/opcoes", {"idNoOrigem": origem, "idNoDestino": destino, "texto": texto}, ta)


s, o_comp = nova_opcao(q, raiz_antiga, "Computador")
check("liga a pergunta inicial nova ao fluxo antigo", s, 201)
s, o_impr = nova_opcao(q, n1, "Impressora")
check("liga a pergunta inicial nova ao cenário novo", s, 201)
nova_opcao(n1, f1, "Sim")
nova_opcao(n1, s1, "Não")
s, o_nr = nova_opcao(s1, f1, "Não resolveu")
check("completa as opções do cenário", s, 201)

s, _ = nova_opcao(f1, n1, "x")
check("etapa final não pode ter opção -> 400", s, 400)
s, _ = nova_opcao(n1, n1, "x")
check("opção para o próprio nó -> 400", s, 400)
s, _ = nova_opcao(n1, f1, "Sim")
check("texto repetido na mesma pergunta -> 409", s, 409)
s, _ = nova_opcao(999999, f1, "x")
check("origem inexistente -> 404", s, 404)
s, _ = nova_opcao(n1, 999999, "x")
check("destino inexistente -> 404", s, 404)

# ---------- Publicar o cenário ----------
s, r = req("PUT", f"{A}/nos/{f1}", {"ativo": True}, ta)
check("ativar um nó solto é recusado (ficaria órfão) -> 422", (s, "NO_ORFAO" in codigos(r)), (422, True))
s, r = req("PUT", f"{A}/nos/{q}/raiz", None, ta)
check("definir a nova pergunta inicial ativa o ramo inteiro", (s, r["validacao"]["valida"]), (200, True))
check("o ramo novo foi ativado", {n1, s1, f1, q} <= set(r["afetados"]), True)
s, arv3 = req("GET", A + "/arvore", token=ta)
ativos = {n["id"]: n["ativo"] for n in arv3["nos"]}
check("raiz nova e cenário ativos; raiz antiga continua ativa", (ativos[q], ativos[n1], ativos[raiz_antiga]), (True, True, True))
check("árvore segue válida", arv3["validacao"]["valida"], True)

if INCLUIR_MOTOR:
    s, e = req("POST", "/api/triagem/iniciar", token=ta)
    check("motor: a triagem começa na pergunta inicial nova", e["noAtual"]["pergunta"], "Qual é o tipo do problema?")
    check("motor: oferece os dois cenários", sorted(o["texto"] for o in e["opcoes"]), ["Computador", "Impressora"])
    op = next(o["id"] for o in e["opcoes"] if o["texto"] == "Impressora")
    s, e = req("POST", f"/api/triagem/{e['idFluxo']}/responder", {"idOpcao": op}, ta)
    check("motor: segue para o cenário novo", e["noAtual"]["pergunta"], "A impressora está ligada?")
    s, r = req("DELETE", f"{A}/nos/{n1}", token=ta)
    check("excluir nó usado numa triagem -> 409 com orientação", (s, "Desative" in (r or {}).get("erro", "")), (409, True))

# ---------- Trava de ciclo e de órfão ----------
s, r = nova_opcao(s1, q, "Voltar")
check("opção que cria ciclo é recusada -> 422", (s, "CICLO" in codigos(r)), (422, True))
s, r = req("DELETE", f"{A}/opcoes/{o_comp['id']}", token=ta)
check("apagar a única ligação com o fluxo antigo (órfãos) -> 422", (s, "NO_ORFAO" in codigos(r)), (422, True))
s, arv4 = req("GET", A + "/arvore", token=ta)
check("nenhuma das duas alterações recusadas ficou gravada", sum(len(n["opcoes"]) for n in arv4["nos"]), qtd_opcoes + 5)

# ---------- Avisos não impedem a alteração ----------
s, r = req("DELETE", f"{A}/opcoes/{o_nr['id']}", token=ta)
check("sugestão sem saída é só aviso (200)", (s, r["validacao"]["valida"], "SUGESTAO_SEM_SAIDA" in codigos(r)), (200, True, True))
nova_opcao(s1, f1, "Não resolveu")

# ---------- Edição e versão ----------
s, antes = req("GET", A + "/arvore", token=ta)
versao_antes = next(n for n in antes["nos"] if n["id"] == n1)["versao"]
s, r = req("PUT", f"{A}/nos/{n1}", {"pergunta": "A impressora está ligada na tomada?"}, ta)
check("edita a pergunta", s, 200)
s, r = req("PUT", f"{A}/nos/{n1}", {"solucaoSugerida": "x"}, ta)
check("solução em nó que não é sugestão -> 400", s, 400)
s, r = req("PUT", f"{A}/nos/{s1}", {"solucaoSugerida": "Ligue o cabo.\nAperte o botão."}, ta)
check("edita a solução da sugestão", s, 200)
s, r = req("PUT", f"{A}/opcoes/{o_impr['id']}", {"texto": "Impressora / multifuncional"}, ta)
check("edita o texto de uma opção", s, 200)
s, arv5 = req("GET", A + "/arvore", token=ta)
no_n1 = next(n for n in arv5["nos"] if n["id"] == n1)
check("a versão do nó sobe a cada edição", no_n1["versao"], versao_antes + 1)

# ---------- Ativar e desativar ramo ----------
s, r = req("PUT", f"{A}/nos/{n1}/desativar-ramo", None, ta)
check("desativa o cenário inteiro (nó, sugestão e final)", (s, sorted(r["desativados"])), (200, sorted([n1, s1, f1])))
check("árvore segue válida com o cenário fora do ar", r["validacao"]["valida"], True)
check("opção para nó inativo vira aviso", "OPCAO_PARA_NO_INATIVO" in codigos(r), True)
s, r = req("PUT", f"{A}/nos/{n1}/ativar-ramo", None, ta)
check("reativa o cenário", (s, r["validacao"]["valida"]), (200, True))

# ---------- Auditoria ----------
s, aud = req("GET", f"{A}/auditoria?tabela=no_decisao&idRegistro={n1}", token=ta)
ops = [a["operacao"] for a in aud]
check("auditoria registra criação e edições do nó", ("INSERT" in ops, ops.count("UPDATE") >= 2), (True, True))
edicao = next(a for a in aud if a["operacao"] == "UPDATE" and a["dadosAnteriores"].get("pergunta") == "A impressora está ligada?")
check("auditoria guarda o texto antes e depois", edicao["dadosNovos"]["pergunta"], "A impressora está ligada na tomada?")
check("auditoria guarda quem alterou", edicao["nomeUsuario"], nome_admin)
s, aud = req("GET", A + "/auditoria?limite=5", token=ta)
check("lista a auditoria geral com limite", (s, len(aud)), (200, 5))

# ---------- Exclusão ----------
s, _ = req("DELETE", f"{A}/nos/{q}", token=ta)
check("não exclui a raiz -> 409", s, 409)
s, _ = req("DELETE", f"{A}/nos/999999", token=ta)
check("excluir nó inexistente -> 404", s, 404)

# ---------- Limpeza: volta a árvore ao estado original ----------
s, r = req("PUT", f"{A}/nos/{raiz_antiga}/raiz", None, ta)
check("volta a pergunta inicial original (o cenário de teste sai do ar)", (s, r["validacao"]["valida"]), (200, True))
check("a raiz de teste e seu ramo foram desativados", {q, n1, s1, f1} <= set(r["desativados"]), True)
for no_id in (q, n1, s1, f1):
    s, _ = req("DELETE", f"{A}/nos/{no_id}", token=ta)
    if not INCLUIR_MOTOR:
        check(f"limpeza: exclui o nó de teste {no_id}", s, 200)
s, arv6 = req("GET", A + "/arvore", token=ta)
if not INCLUIR_MOTOR:
    check("a árvore voltou ao tamanho original", (len(arv6["nos"]), sum(len(n["opcoes"]) for n in arv6["nos"])), (qtd_nos, qtd_opcoes))
check("árvore final válida", arv6["validacao"]["valida"], True)

print()
print("TUDO OK" if falhas == 0 else f"{falhas} verificação(ões) falharam")
sys.exit(0 if falhas == 0 else 1)