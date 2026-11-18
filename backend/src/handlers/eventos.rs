use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use futures_util::stream::{self, Stream};
use serde::Serialize;
use tokio::sync::broadcast::{self, error::RecvError};

use crate::{auth::Claims, handlers::chat::WsAuthParams, AppState};

/// Capacidade do canal de eventos. Um cliente lento que perder eventos recebe
/// "resync" e recarrega a lista inteira.
pub const CAPACIDADE_EVENTOS: usize = 256;

/// Aviso de que um chamado mudou. Leva só os ids: o cliente recarrega os dados
/// pela API normal, que já aplica as regras de permissão.
#[derive(Debug, Clone, Serialize)]
pub struct EventoChamado {
    pub tipo: &'static str,
    #[serde(rename = "idChamado")]
    pub id_chamado: i32,
    #[serde(skip)]
    pub id_usuario: i32,
}

/// Publica a mudança para os clientes conectados. Sem ouvintes, o envio falha e é ignorado.
pub fn publicar(state: &AppState, tipo: &'static str, id_chamado: i32, id_usuario: i32) {
    let _ = state.eventos_chamados.send(EventoChamado { tipo, id_chamado, id_usuario });
}

/// Mesma regra de listar_chamados: nível técnico vê todos; os demais, só os próprios.
fn pode_ver(claims: &Claims, evento: &EventoChamado) -> bool {
    claims.nivel_acesso >= 2 || evento.id_usuario == claims.user_id
}

/// GET /api/chamados/eventos?token=...
///
/// Server-Sent Events com criação, alteração e exclusão de chamados. Fica fora do
/// middleware require_auth porque o EventSource do navegador não envia o header
/// Authorization; o token vem na query string, como no chat.
pub async fn stream_eventos(
    State(state): State<AppState>,
    Query(params): Query<WsAuthParams>,
) -> Response {
    let claims = match state.token_manager.validar(&params.token) {
        Ok(c) => c,
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let rx = state.eventos_chamados.subscribe();
    Sse::new(eventos(rx, claims))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

fn eventos(
    rx: broadcast::Receiver<EventoChamado>,
    claims: Claims,
) -> impl Stream<Item = Result<Event, Infallible>> {
    // Encerra a conexão quando o token expira; o cliente reconecta com o token atual.
    let expira = tokio::time::Instant::now()
        + Duration::from_secs((claims.exp as u64).saturating_sub(agora_unix()));

    stream::unfold((rx, claims), move |(mut rx, claims)| async move {
        loop {
            let recebido = tokio::select! {
                r = rx.recv() => r,
                _ = tokio::time::sleep_until(expira) => return None,
            };
            let evento = match recebido {
                Ok(evento) if pode_ver(&claims, &evento) => Event::default()
                    .event("chamado")
                    .json_data(&evento)
                    .unwrap_or_else(|_| Event::default().event("resync").data("{}")),
                Ok(_) => continue,
                Err(RecvError::Lagged(_)) => Event::default().event("resync").data("{}"),
                Err(RecvError::Closed) => return None,
            };
            return Some((Ok(evento), (rx, claims)));
        }
    })
}

fn agora_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
