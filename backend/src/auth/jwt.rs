use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Claims customizadas embutidas no token JWT.
/// Carregam apenas o necessário para autorização (RBAC) sem expor dados sensíveis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    #[serde(rename = "userId")]
    pub user_id: i32,
    pub email: String,
    pub cargo: String,
    #[serde(rename = "nivelAcesso")]
    pub nivel_acesso: i32,
    pub iat: usize,
    pub exp: usize,
    pub iss: String,
}

#[derive(Clone)]
pub struct TokenManager {
    secret: String,
    ttl: Duration,
}

impl TokenManager {
    pub fn new(secret: String, ttl: Duration) -> Self {
        Self { secret, ttl }
    }

    /// Cria um novo JWT assinado (HMAC-SHA256) para o usuário autenticado.
    pub fn gerar(
        &self,
        user_id: i32,
        email: &str,
        cargo: &str,
        nivel_acesso: i32,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let agora = chrono::Utc::now().timestamp() as usize;
        let expira_em = agora + self.ttl.as_secs() as usize;

        let claims = Claims {
            user_id,
            email: email.to_string(),
            cargo: cargo.to_string(),
            nivel_acesso,
            iat: agora,
            exp: expira_em,
            iss: "servicedesk-api".to_string(),
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }

    /// Decodifica e verifica a assinatura/expiração de um token recebido.
    pub fn validar(&self, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        let dados = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )?;
        Ok(dados.claims)
    }
}
