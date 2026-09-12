use bcrypt::{hash, verify, DEFAULT_COST};

/// Custo do bcrypt: equilíbrio razoável entre segurança e latência de login.
/// DEFAULT_COST (12) é o mesmo usado na versão anterior em Go.
const CUSTO_BCRYPT: u32 = DEFAULT_COST;

/// Aplica a regra mínima de complexidade exigida no cadastro.
/// Mantida simples de propósito: o requisito não-funcional de Segurança do TCC
/// pede autenticação e autorização controladas, não uma política específica de senha.
pub fn validar_forca_senha(senha: &str) -> Result<(), String> {
    if senha.len() < 8 {
        return Err("a senha deve ter pelo menos 8 caracteres".to_string());
    }
    Ok(())
}

/// Gera o hash bcrypt de uma senha em texto puro.
pub fn hash_senha(senha_plana: &str) -> Result<String, bcrypt::BcryptError> {
    hash(senha_plana, CUSTO_BCRYPT)
}

/// Verifica se a senha em texto puro corresponde ao hash armazenado.
pub fn comparar_senha(hash_armazenado: &str, senha_plana: &str) -> bool {
    verify(senha_plana, hash_armazenado).unwrap_or(false)
}
