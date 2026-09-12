use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use sqlx::Row;

use crate::{
    auth::{comparar_senha, hash_senha, validar_forca_senha, Claims},
    models::{AuthResponse, ErroResposta, LoginInput, RegisterInput, Usuario},
    AppState,
};

/// Corresponde ao seed "Default" em migrations/001_init_auth.sql.
const CARGO_DEFAULT_ID: i32 = 1;

fn erro(status: StatusCode, mensagem: impl Into<String>) -> Response {
    (status, Json(ErroResposta::new(mensagem))).into_response()
}

/// POST /api/auth/register — cria uma nova conta de usuário.
pub async fn register(
    State(state): State<AppState>,
    Json(mut input): Json<RegisterInput>,
) -> Response {
    input.nome = input.nome.trim().to_string();
    input.email = input.email.trim().to_lowercase();

    if input.nome.is_empty() || input.email.is_empty() || input.senha.is_empty() {
        return erro(StatusCode::BAD_REQUEST, "nome, e-mail e senha são obrigatórios");
    }
    if !input.email.contains('@') {
        return erro(StatusCode::BAD_REQUEST, "informe um e-mail válido");
    }
    if let Err(mensagem) = validar_forca_senha(&input.senha) {
        return erro(StatusCode::BAD_REQUEST, mensagem);
    }

    let id_cargo = input.id_cargo.unwrap_or(CARGO_DEFAULT_ID);

    let senha_hash = match hash_senha(&input.senha) {
        Ok(h) => h,
        Err(_) => return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao processar a senha"),
    };

    let resultado = sqlx::query(
        r#"
        INSERT INTO usuario (id_cargo, nome, email, senha_hash, setor)
        VALUES ($1, $2, $3, $4, NULLIF($5, ''))
        RETURNING id
        "#,
    )
    .bind(id_cargo)
    .bind(&input.nome)
    .bind(&input.email)
    .bind(&senha_hash)
    .bind(input.setor.unwrap_or_default())
    .fetch_one(&state.db)
    .await;

    let novo_id: i32 = match resultado {
        Ok(row) => row.get("id"),
        Err(e) => {
            if is_unique_violation(&e) {
                return erro(
                    StatusCode::CONFLICT,
                    "já existe uma conta cadastrada com este e-mail",
                );
            }
            tracing::error!("erro ao criar usuário: {e}");
            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao criar usuário");
        }
    };

    let usuario = match buscar_usuario_por_id(&state, novo_id).await {
        Ok(u) => u,
        Err(_) => {
            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "usuário criado, mas houve erro ao carregar os dados",
            )
        }
    };

    let token = match state
        .token_manager
        .gerar(usuario.id, &usuario.email, &usuario.cargo, usuario.nivel_acesso)
    {
        Ok(t) => t,
        Err(_) => return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao gerar sessão"),
    };

    (StatusCode::CREATED, Json(AuthResponse { token, usuario })).into_response()
}

/// POST /api/auth/login — autentica um usuário existente por e-mail e senha.
pub async fn login(State(state): State<AppState>, Json(input): Json<LoginInput>) -> Response {
    let email = input.email.trim().to_lowercase();
    // Mensagem intencionalmente genérica: não revelar se o e-mail existe ou não.
    let credenciais_invalidas = "e-mail ou senha incorretos";

    let linha = sqlx::query(
        r#"
        SELECT u.id, u.senha_hash, u.ativo, c.cargo, np.nivel
        FROM usuario u
        JOIN cargo c ON c.id = u.id_cargo
        JOIN nivel_permissao np ON np.id = c.id_permissao
        WHERE u.email = $1
        "#,
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await;

    let linha = match linha {
        Ok(Some(l)) => l,
        Ok(None) => return erro(StatusCode::UNAUTHORIZED, credenciais_invalidas),
        Err(e) => {
            tracing::error!("erro ao consultar usuário: {e}");
            return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao consultar usuário");
        }
    };

    let id: i32 = linha.get("id");
    let senha_hash: String = linha.get("senha_hash");
    let ativo: bool = linha.get("ativo");

    if !ativo {
        return erro(
            StatusCode::FORBIDDEN,
            "esta conta está inativa; contate o administrador",
        );
    }
    if !comparar_senha(&senha_hash, &input.senha) {
        return erro(StatusCode::UNAUTHORIZED, credenciais_invalidas);
    }

    let usuario = match buscar_usuario_por_id(&state, id).await {
        Ok(u) => u,
        Err(_) => {
            return erro(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao carregar dados do usuário",
            )
        }
    };

    let token = match state
        .token_manager
        .gerar(usuario.id, &usuario.email, &usuario.cargo, usuario.nivel_acesso)
    {
        Ok(t) => t,
        Err(_) => return erro(StatusCode::INTERNAL_SERVER_ERROR, "erro ao gerar sessão"),
    };

    (StatusCode::OK, Json(AuthResponse { token, usuario })).into_response()
}

/// GET /api/auth/me — devolve os dados do usuário autenticado a partir do token enviado.
pub async fn me(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Response {
    match buscar_usuario_por_id(&state, claims.user_id).await {
        Ok(usuario) => (StatusCode::OK, Json(usuario)).into_response(),
        Err(_) => erro(StatusCode::NOT_FOUND, "usuário não encontrado"),
    }
}

async fn buscar_usuario_por_id(state: &AppState, id: i32) -> Result<Usuario, sqlx::Error> {
    let linha = sqlx::query(
        r#"
        SELECT u.id, u.id_cargo, u.nome, u.email, u.setor, u.data_cadastro, u.ativo,
               c.cargo, np.nivel
        FROM usuario u
        JOIN cargo c ON c.id = u.id_cargo
        JOIN nivel_permissao np ON np.id = c.id_permissao
        WHERE u.id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Usuario {
        id: linha.get("id"),
        id_cargo: linha.get("id_cargo"),
        nome: linha.get("nome"),
        email: linha.get("email"),
        setor: linha.get("setor"),
        data_cadastro: linha.get("data_cadastro"),
        ativo: linha.get("ativo"),
        cargo: linha.get("cargo"),
        nivel_acesso: linha.get("nivel"),
    })
}

fn is_unique_violation(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some("23505"))
}
