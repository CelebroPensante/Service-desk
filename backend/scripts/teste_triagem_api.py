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
check("ainda não concluída", e["concluido"], False)

s, e2 = req("GET", f"/api/triagem/{f1}", token=ta)
check("GET retoma no mesmo ponto", e2["noAtual"]["id"], e["noAtual"]["id"])

s, e = req("POST", f"/api/triagem/{f1}/resolver", token=ta)
check("resolver conclui", (s, e["concluido"], e["resultado"]), (200, True, "resolvido"))
s, _ = req("POST", f"/api/triagem/{f1}/resolver", token=ta)
check("resolver de novo -> 409", s, 409)

# --- Caminho 2: etapa final -> abrir chamado
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f2 = e["idFluxo"]
s, e = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": opcao(e, "Sim")}, ta)
s, e = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": opcao(e, "Não")}, ta)
check("etapa final conclui com abrir_chamado", (e["noAtual"]["tipoNo"], e["concluido"], e["resultado"]), ("etapa_final", True, "abrir_chamado"))
check("etapa final não tem opções", e["opcoes"], [])
s, _ = req("POST", f"/api/triagem/{f2}/responder", {"idOpcao": 1}, ta)
check("responder após concluir -> 409", s, 409)

# --- Caminho 3: sugestão -> "Não resolveu" -> abrir chamado
s, e = req("POST", "/api/triagem/iniciar", token=ta)
f3 = e["idFluxo"]
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não")}, ta)
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não")}, ta)
s, e = req("POST", f"/api/triagem/{f3}/responder", {"idOpcao": opcao(e, "Não resolveu")}, ta)
check("'Não resolveu' leva a abrir_chamado", e["resultado"], "abrir_chamado")

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