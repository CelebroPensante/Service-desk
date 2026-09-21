use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;

use crate::{models::MensagemChat, AppState};

const TAMANHO_MAX_TEXTO: usize = 2000;

#[derive(Debug, Deserialize)]
pub struct WsAuthParams {
    pub token: String,
}

/// Formato que o cliente envia pelo WebSocket: {"texto": "olá"}
#[derive(Debug, Deserialize)]
struct MensagemRecebida {
    texto: String,
}

/// GET /api/chamados/:id/chat/ws?token=...
///
/// Fica FORA do middleware require_auth: o WebSocket do navegador não
/// permite header Authorization, então o token vem na query string.
pub async fn chat_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
    Query(params): Query<WsAuthParams>,
) -> Response {
    let claims = match state.token_manager.validar(&params.token) {
        Ok(c) => c,
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };

    // Recusa o upgrade se o chamado não existe.
    let existe = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chamado WHERE id = $1)",
    )
    .bind(id_chamado)
    .fetch_one(&state.db)
    .await;

    match existe {
        Ok(true) => {}
        Ok(false) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("erro ao verificar chamado {id_chamado}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    // TODO: verificar se este usuário pode acessar este chamado.

    ws.on_upgrade(move |socket| lidar_conexao(socket, state, id_chamado, claims.user_id))
}

/// GET /api/chamados/:id/chat/mensagens (protegida por require_auth)
/// Histórico para carregar quando o usuário abre o chamado.
/// TODO: verificar se este usuário pode acessar este chamado (mesma regra do chat_ws).
pub async fn listar_mensagens(
    State(state): State<AppState>,
    Path(id_chamado): Path<i32>,
) -> Result<Json<Vec<MensagemChat>>, StatusCode> {
    sqlx::query_as::<_, MensagemChat>(
        "SELECT m.id, m.id_chamado, m.id_usuario, u.nome AS nome_usuario,
                m.texto, m.data_envio
        FROM mensagem_chat m
        JOIN usuario u ON u.id = m.id_usuario
        WHERE m.id_chamado = $1
        ORDER BY m.data_envio ASC, m.id ASC",
    )
    .bind(id_chamado)
    .fetch_all(&state.db)
    .await
    .map(Json)
    .map_err(|e| {
        tracing::error!("erro ao listar mensagens do chamado {id_chamado}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

/// Pega o canal de broadcast da sala (cria se ainda não existir).
fn obter_ou_criar_sala(state: &AppState, id_chamado: i32) -> broadcast::Sender<String> {
    let mut salas = state.chat_rooms.lock().unwrap();

    salas
        .entry(id_chamado)
        .or_insert_with(|| {
            let (tx, _rx) = broadcast::channel(100);
            tx
        })
        .clone()
}

async fn lidar_conexao(socket: WebSocket, state: AppState, id_chamado: i32, id_usuario: i32) {
    let tx = obter_ou_criar_sala(&state, id_chamado);
    let mut rx = tx.subscribe();

    let (mut sender, mut receiver) = socket.split();

    // Task 1: tudo que entra no broadcast da sala é repassado a este cliente.
    let mut task_envio = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if sender.send(Message::Text(msg)).await.is_err() {
                        break; // cliente desconectou
                    }
                }
                // Cliente lento perdeu mensagens: segue em frente.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Task 2: lê mensagens do cliente, salva no banco e publica na sala.
    let db = state.db.clone();
    let mut task_recebe = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(bruto) => {
                    let entrada: MensagemRecebida = match serde_json::from_str(&bruto) {
                        Ok(v) => v,
                        Err(_) => continue, // JSON inválido: ignora
                    };

                    let texto = entrada.texto.trim();
                    if texto.is_empty() || texto.chars().count() > TAMANHO_MAX_TEXTO {
                        continue;
                    }

                    let salva = sqlx::query_as::<_, MensagemChat>(
                        "WITH nova AS (
                            INSERT INTO mensagem_chat (id_chamado, id_usuario, texto)
                            VALUES ($1, $2, $3)
                            RETURNING id, id_chamado, id_usuario, texto, data_envio
                        )
                        SELECT n.id, n.id_chamado, n.id_usuario, u.nome AS nome_usuario,
                                n.texto, n.data_envio
                        FROM nova n
                        JOIN usuario u ON u.id = n.id_usuario",
                    )
                    .bind(id_chamado)
                    .bind(id_usuario)
                    .bind(texto)
                    .fetch_one(&db)
                    .await;

                    match salva {
                        Ok(m) => {
                            if let Ok(json) = serde_json::to_string(&m) {
                                let _ = tx.send(json);
                            }
                        }
                        Err(e) => tracing::error!("erro ao salvar mensagem: {e}"),
                    }
                }
                Message::Close(_) => break,
                _ => {} // ping/pong/binary
            }
        }
    });

    // Quando uma das tasks termina, encerra a outra.
    tokio::select! {
        _ = &mut task_envio => task_recebe.abort(),
        _ = &mut task_recebe => task_envio.abort(),
    }
}