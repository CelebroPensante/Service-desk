pub mod auth;
pub mod comentario;
pub mod chat;
pub mod anexo; 
pub mod triagem;
pub mod triagem_admin;
pub use auth::{
    Usuario, RegisterInput, LoginInput, AuthResponse, ErroResposta,
    CargoResumo, NovoCargoInput, UpdateCargoInput, NivelPermissao,
    UsuarioResumo, AtribuirCargoInput,
    Chamado, NovoChamadoInput, AtualizarChamadoInput, AtualizarStatusChamadoInput,
    AtribuirAtendenteInput, CategoriaResumo, PrioridadeResumo, StatusChamadoResumo,
    TecnicoResumo, SetorResumo,
};
pub use comentario::Comentario;
pub use chat::MensagemChat;
pub use anexo::Anexo;
