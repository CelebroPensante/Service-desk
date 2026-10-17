import json, urllib.request, urllib.error
B = "http://localhost:8080"

def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

def check(desc, got, esperado):
    print(("OK    " if got == esperado else "FALHOU"), desc, "->", got)

def opcao(estado, texto):
    return next(o["id"] for o in estado["opcoes"] if o["texto"] == texto)

def tok(nome, email):
    s, r = req("POST", "/api/auth/register", {"nome": nome, "email": email, "senha": "senha12345"})
    if s not in (200, 201):
        s, r = req("POST", "/api/auth/login", {"email": email, "senha": "senha12345"})
    return r["token"]

ta = tok("Ana Teste", "ana@teste.com")
tb = tok("Bia Teste", "bia@teste.com")

s, _ = req("POST", "/api/triagem/iniciar")
check("sem token é recusado", s, 401)

# --- Caminho 1: sugestão de solução -> usuário confirma que resolveu
s, e = req("POST", "/api/triagem/iniciar", token=ta)
check("iniciar devolve 201", s, 201)
check("pergunta corrente é a raiz", e["noAtual"]["pergunta"], "O computador liga?")
check("opções da raiz", [o["texto"] for o in e["opcoes"]], ["Sim", "Não"])
check("não expõe o destino das opções", set(e["opcoes"][0].keys()), {"id", "texto"})
f1 = e["idFluxo"]

s, e = req("POST", f"/api/triagem/{f1}/responder", {"idOpcao": opcao(e, "Não")}, ta)
check("Não -> cabo de energia", e["noAtual"]["pergunta"], "O cabo de energia está conectado?")
s, e = req("POST", f"/api/triagem/{f1}/responder", {"idOpcao": opcao(e, "Não")}, ta)
check("Não -> sugestão de solução", e["noAtual"]["tipoNo"], "sugestao_solucao")
check("sugestão traz a solução", bool(e["noAtual"]["solucaoSugerida"]), True)
check("sugestão permite resolver", e["podeResolver"], True)
# US-22: passo a passo
check("sugestão traz o passo a passo (lista de passos)", len(e["noAtual"]["passos"]) >= 3, True)
check("passos vêm sem numeração e sem linhas vazias",
      all(p and not p[0].isdigit() for p in e["noAtual"]["passos"]), True)
check("passos reunidos = texto da solução",
      "\n".join(e["noAtual"]["passos"]), e["noAtual"]["solucaoSugerida"])
check("ainda não concluída", e["concluido"], False)

s, e2 = req("GET", f"/api/triagem/{f1}", token=ta)
check("GET retoma no mesmo ponto", e2["noAtual"]["id"], e["noAtual"]["id"])

s, e = req("POST", f"/api/triagem/{f1}/resolver", token=ta)
check("resolver conclui", (s, e["concluido"], e["resultado"]), (200, True, "resolvido"))
s, _ = req("POST", f"/api/triagem/{f1}/resolver", token=ta)
check("resolver de novo -> 409", s, 409)

# US-24: percurso registrado (Não -> Não -> Resolveu)
s, pc = req("GET", f"/api/triagem/{f1}/percurso", token=ta)
check("percurso devolve 200", s, 200)
check("percurso tem 3 passos numerados", [p["ordem"] for p in pc["passos"]], [1, 2, 3])
check("passos: pergunta -> resposta",
      [(p["pergunta"], p["resposta"]) for p in pc["passos"]],
      [("O computador liga?", "Não"),
       ("O cabo de energia está conectado?", "Não"),
       ("Sugestão: reconectar o cabo de energia", "Resolveu o meu problema")])
check("passos trazem data da resposta", all(p["dataResposta"] for p in pc["passos"]), True)
check("histórico em texto tem os 3 passos + conclusão", len(pc["historico"].strip().split("\n")), 4)
check("histórico termina com a conclusão", pc["historico"].strip().split("\n")[-1], "Conclusão: resolvido na triagem")
check("triagem concluída no percurso", pc["concluido"], True)

# --- Caminho 2: etapa final -> abrir chamado
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f2 = e["idFluxo"]
s, e = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": opcao(e, "Sim")}, ta)
s, e = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": opcao(e, "Não")}, ta)
check("etapa final conclui com abrir_chamado", (e["noAtual"]["tipoNo"], e["concluido"], e["resultado"]), ("etapa_final", True, "abrir_chamado"))
check("etapa final não tem opções", e["opcoes"], [])
s, _ = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": 1}, ta)
check("responder após concluir -> 409", s, 409)
s, pc2 = req("GET", f"/api/triagem/{f2}/percurso", token=ta)
check("percurso da etapa final: 2 passos", len(pc2["passos"]), 2)
check("histórico da etapa final termina em abrir chamado",
      pc2["historico"].strip().split("\n")[-1].startswith("Conclusão: Abrir chamado") , True)

# --- Caminho 3: sugestão -> "Não resolveu" -> abrir chamado
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f3 = e["idFluxo"]
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não")}, ta)
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não")}, ta)
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não resolveu")}, ta)
check("'Não resolveu' leva a abrir_chamado", e["resultado"], "abrir_chamado")
s, pc3 = req("GET", f"/api/triagem/{f3}/percurso", token=ta)
check("percurso registra 'Não resolveu' como resposta da sugestão",
      pc3["passos"][-1]["resposta"], "Não resolveu")
check("passo da sugestão guarda a pergunta da sugestão",
      pc3["passos"][-1]["pergunta"], "Sugestão: reconectar o cabo de energia")

# --- US-22: nós que não são sugestão não têm passos
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f5 = e["idFluxo"]
check("pergunta não traz passos", e["noAtual"]["passos"], [])

# --- US-22: sugestão exibida e abandonada (fica sem resposta no registro)
s, e = req("POST", f"/api/triagem/{f5}/responder", {"idOpcao": opcao(e, "Não")}, ta)
s, e = req("POST", f"/api/triagem/{f5}/responder", {"idOpcao": opcao(e, "Não")}, ta)
check("f5 parou na sugestão, sem concluir", (e["noAtual"]["tipoNo"], e["concluido"]), ("sugestao_solucao", False))

# --- Regras de segurança e validação
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f4 = e["idFluxo"]
op_raiz = opcao(e, "Sim")
s, e = req("POST", f"/api/triagem/{f4}/responder", {"idOpcao": op_raiz}, ta)
s, _ = req("POST", f"/api/triagem/{f4}/responder", {"idOpcao": op_raiz}, ta)
check("opção de outro nó -> 400", s, 400)
s, _ = req("POST", f"/api/triagem/{f4}/responder", {"idOpcao": 999999}, ta)
check("opção inexistente -> 400", s, 400)
s, _ = req("POST", f"/api/triagem/{f4}/resolver", token=ta)
check("resolver fora de sugestão -> 409", s, 409)
s, _ = req("GET", f"/api/triagem/{f4}", token=tb)
check("outro usuário não vê a triagem -> 404", s, 404)
s, _ = req("POST", f"/api/triagem/{f4}/responder", {"idOpcao": op_raiz}, tb)
check("outro usuário não responde -> 404", s, 404)
s, _ = req("GET", "/api/triagem/999999", token=ta)
check("triagem inexistente -> 404", s, 404)
s, _ = req("GET", f"/api/triagem/{f1}/percurso", token=tb)
check("outro usuário não vê o percurso -> 404", s, 404)
s, _ = req("GET", f"/api/triagem/{f1}/percurso")
check("percurso sem token -> 401", s, 401)
s, _ = req("GET", "/api/triagem/999999/percurso", token=ta)
check("percurso de triagem inexistente -> 404", s, 404)
s, pc5 = req("GET", f"/api/triagem/{f5}/percurso", token=ta)
check("triagem parada na sugestão: 2 passos, não concluída", (len(pc5["passos"]), pc5["concluido"]), (2, False))
s, pc4 = req("GET", f"/api/triagem/{f4}/percurso", token=ta)
check("resposta inválida não gera passo (f4 tem só o passo válido)", len(pc4["passos"]), 1)

# =====================================================================
# US-23: preenchimento automático do chamado pela triagem
# =====================================================================
def percorrer(token, respostas):
    """Inicia uma triagem e responde pelo texto das opções. Devolve (idFluxo, estado)."""
    _, est = req("POST", "/api/triagem/iniciar", token=token)
    fluxo = est["idFluxo"]
    for texto in respostas:
        _, est = req("POST", f"/api/triagem/{fluxo}/responder", {"idOpcao": opcao(est, texto)}, token)
    return fluxo, est

_, cats = req("GET", "/api/chamados/categorias", token=ta)
_, pris = req("GET", "/api/chamados/prioridades", token=ta)
cat = {c["categoria"]: c["id"] for c in cats}
pri = {p["prioridade"]: p["id"] for p in pris}
ID_OUTROS, ID_BAIXA = cat["Outros"], pri["Baixa"]

# --- A: a etapa final informa como o chamado será preenchido
fA, eA = percorrer(ta, ["Sim", "Não"])   # monitor sem imagem -> falha de hardware
pre = eA["preenchimento"]
check("etapa final traz o preenchimento (categoria, prioridade, setor)",
      (pre["categoria"], pre["prioridade"], pre["setor"]), ("Hardware", "Alta", "Infraestrutura"))
check("preenchimento traz também os ids", all(pre[k] for k in ("idCategoria", "idPrioridade", "idSetor")), True)
s, eA2 = req("GET", f"/api/triagem/{fA}", token=ta)
check("GET retoma a etapa final com o mesmo preenchimento", eA2["preenchimento"], pre)
_, e_meio = req("POST", "/api/triagem/iniciar", token=ta)
check("nó que não é etapa final não traz preenchimento", e_meio["preenchimento"], None)
f_aberta = e_meio["idFluxo"]

# --- B: chamado nasce da triagem; o servidor aplica a classificação
corpo = {"titulo": "Monitor sem imagem", "descricaoDetalhada": "Liga, mas não aparece imagem.",
         "idCategoria": ID_OUTROS, "idPrioridade": ID_BAIXA, "idFluxoTriagem": fA,
         "idSetor": 1}  # solicitante não define setor: deve ser ignorado
s, ch = req("POST", "/api/chamados", corpo, ta)
check("chamado criado a partir da triagem -> 201", s, 201)
check("categoria/prioridade vêm da triagem, mesmo se o formulário mandar outras",
      (ch["categoria"], ch["prioridade"]), ("Hardware", "Alta"))
check("chamado encaminhado ao setor da triagem", ch["setor"], "Infraestrutura")
check("chamado guarda a triagem de origem", ch["idFluxoTriagem"], fA)
check("status inicial segue 'Aberto'", ch["status"], "Aberto")
chA = ch["id"]

s, c2 = req("GET", f"/api/chamados/{chA}", token=ta)
check("consulta do chamado devolve setor e triagem de origem", (c2["setor"], c2["idFluxoTriagem"]), ("Infraestrutura", fA))

# --- C: a triagem registra o chamado gerado no histórico
s, pcA = req("GET", f"/api/triagem/{fA}/percurso", token=ta)
check("histórico registra o chamado aberto",
      pcA["historico"].strip().split("\n")[-1], f"Chamado aberto: CHM-{chA:04d}")

# --- D, E, F: a triagem só vale uma vez, só do dono, só concluída em etapa final
s, _ = req("POST", "/api/chamados", corpo, ta)
check("triagem já usada não gera outro chamado -> 409", s, 409)
s, _ = req("POST", "/api/chamados", {**corpo, "idFluxoTriagem": fA}, tb)
check("triagem de outro usuário -> 404", s, 404)
s, _ = req("POST", "/api/chamados", {**corpo, "idFluxoTriagem": f_aberta}, ta)
check("triagem ainda não concluída -> 409", s, 409)
s, _ = req("POST", "/api/chamados", {**corpo, "idFluxoTriagem": f1}, ta)
check("triagem resolvida (sem etapa final) -> 409", s, 409)
s, _ = req("POST", "/api/chamados", {**corpo, "idFluxoTriagem": 999999}, ta)
check("triagem inexistente -> 404", s, 404)

# --- G: sem triagem, tudo como antes
s, man = req("POST", "/api/chamados", {"titulo": "Pedido manual", "descricaoDetalhada": "x",
             "idCategoria": ID_OUTROS, "idPrioridade": ID_BAIXA, "idSetor": 1}, ta)
check("sem triagem: categoria/prioridade escolhidas são respeitadas",
      (man["categoria"], man["prioridade"]), ("Outros", "Baixa"))
check("sem triagem: solicitante não define setor", (man["setor"], man["idFluxoTriagem"]), (None, None))

# --- H: edição conforme permissão
edicao = {"titulo": "Monitor sem imagem (editado)", "descricaoDetalhada": "Atualizei a descrição.",
          "idCategoria": ID_OUTROS, "idPrioridade": ID_BAIXA, "idSetor": 2}
s, ed = req("PUT", f"/api/chamados/{chA}", edicao, ta)
check("solicitante edita título/descrição do chamado da triagem -> 200", s, 200)
check("solicitante não reclassifica chamado da triagem (categoria/prioridade/setor mantidos)",
      (ed["categoria"], ed["prioridade"], ed["setor"]), ("Hardware", "Alta", "Infraestrutura"))
check("título foi atualizado", ed["titulo"], "Monitor sem imagem (editado)")
s, ed2 = req("PUT", f"/api/chamados/{man['id']}", {**edicao, "idCategoria": cat["Rede"]}, ta)
check("chamado manual: solicitante ainda reclassifica -> categoria nova", ed2["categoria"], "Rede")

# --- I: lista de setores
s, setores = req("GET", "/api/chamados/setores", token=ta)
check("lista de setores", (s, {x["nome"] for x in setores} >= {"Infraestrutura", "Redes", "Sistemas", "Segurança e Acessos"}), (200, True))
s, _ = req("GET", "/api/chamados/setores")
check("setores sem token -> 401", s, 401)

# --- K: outra etapa final define outra classificação
fK, eK = percorrer(ta, ["Sim", "Sim"])   # tem imagem no monitor -> software
check("outra etapa final: Software / Média / Sistemas",
      (eK["preenchimento"]["categoria"], eK["preenchimento"]["prioridade"], eK["preenchimento"]["setor"]),
      ("Software", "Média", "Sistemas"))

# --- L: técnico (opcional; defina TECNICO_EMAIL e TECNICO_SENHA com um usuário de nível >= 2)
import os
tec_email, tec_senha = os.environ.get("TECNICO_EMAIL"), os.environ.get("TECNICO_SENHA")
if tec_email and tec_senha:
    s, r = req("POST", "/api/auth/login", {"email": tec_email, "senha": tec_senha})
    tt = r["token"]
    # triagem do técnico
    fT, eT = percorrer(tt, ["Sim", "Sim"])
    s, chT = req("POST", "/api/chamados", {"titulo": "Software lento", "descricaoDetalhada": "x",
                 "idCategoria": cat["Rede"], "idPrioridade": pri["Crítica"], "idFluxoTriagem": fT}, tt)
    check("técnico ajusta categoria/prioridade preenchidas pela triagem",
          (chT["categoria"], chT["prioridade"]), ("Rede", "Crítica"))
    check("técnico sem setor no formulário: vale o setor da triagem", chT["setor"], "Sistemas")
    id_redes = next(x["id"] for x in setores if x["nome"] == "Redes")
    s, edT = req("PUT", f"/api/chamados/{chA}", {**edicao, "idCategoria": cat["Software"], "idPrioridade": pri["Média"], "idSetor": id_redes}, tt)
    check("técnico reclassifica chamado vindo da triagem (categoria/prioridade/setor)",
          (edT["categoria"], edT["prioridade"], edT["setor"]), ("Software", "Média", "Redes"))
    s, tecs = req("GET", "/api/tecnicos", token=tt)
    check("lista de técnicos informa o setor de cada um", all("idSetor" in x for x in tecs), True)
    s, _ = req("GET", "/api/tecnicos", token=ta)
    check("solicitante não lista técnicos -> 403", s, 403)
else:
    print("(pulado) checagens do técnico: defina TECNICO_EMAIL e TECNICO_SENHA para rodá-las")

print()
print("Registro da US-22 (rode no pgAdmin/psql para conferir a eficiência):")
print("  SELECT * FROM vw_eficiencia_sugestao;")
print("  SELECT * FROM vw_resumo_triagem;")
print("  SELECT * FROM vw_respostas_frequentes ORDER BY pergunta, vezes DESC;")
print("  SELECT id_fluxo, ordem, pergunta, resposta FROM passo_triagem ORDER BY id_fluxo, ordem;")
print(f"  Triagens deste teste: resolvida={f1}, final={f2}, nao_resolveu={f3}, abandonada na sugestao={f5}")
