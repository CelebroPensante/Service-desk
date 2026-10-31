//! Entrada nativa opcional; vídeo e escolha da tela ficam com o WebRTC do navegador.
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::Deserialize;
use serde_json::json;
use std::{net::TcpStream, time::Duration};
use tungstenite::{stream::MaybeTlsStream, Message};

#[derive(Default)]
struct Grant {
    session: String,
}
impl Grant {
    fn allows(&self, session: &str) -> bool {
        !self.session.is_empty() && self.session == session
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Input {
    Move { x: f64, y: f64 },
    Button { button: u8, down: bool },
    Scroll { delta: i32 },
    Key { key: String, down: bool },
}
impl Input {
    fn valid(&self) -> bool {
        match self {
            Self::Move { x, y } => {
                x.is_finite() && y.is_finite() && (0.0..=1.0).contains(x) && (0.0..=1.0).contains(y)
            }
            Self::Button { button, .. } => *button <= 2,
            Self::Scroll { delta } => (-10..=10).contains(delta),
            Self::Key { key, .. } => native_key(key).is_some(),
        }
    }
}
fn position(value: f64, size: i32) -> i32 {
    (value * (size - 1).max(0) as f64).round() as i32
}
fn native_key(key: &str) -> Option<Key> {
    Some(match key {
        "Enter" => Key::Return,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Insert" => Key::Insert,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "Shift" => Key::Shift,
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => {
            let mut chars = key.chars();
            let c = chars.next()?;
            if chars.next().is_some() || c.is_control() {
                return None;
            }
            Key::Unicode(c)
        }
    })
}
fn validate_layout(monitors: &[(i32, i32, i32, i32)]) -> Result<(i32, i32), String> {
    match monitors {
        [(0,0,w,h)] if *w > 0 && *h > 0 => Ok((*w,*h)),
        _ => Err("Controle requer um único monitor ativo na origem (0,0). Compartilhe esse monitor inteiro; múltiplos monitores permitem apenas visualização.".into()),
    }
}
#[cfg(target_os = "linux")]
fn display_size(_enigo: &Enigo) -> Result<(i32, i32), String> {
    use x11rb::{connection::Connection, protocol::randr::ConnectionExt};
    let (connection, screen) = x11rb::connect(None).map_err(|e| e.to_string())?;
    let monitors = connection
        .randr_get_monitors(connection.setup().roots[screen].root, true)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?
        .monitors;
    let bounds: Vec<_> = monitors
        .iter()
        .map(|m| (m.x as i32, m.y as i32, m.width as i32, m.height as i32))
        .collect();
    validate_layout(&bounds)
}
#[cfg(target_os = "windows")]
fn display_size(enigo: &Enigo) -> Result<(i32, i32), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};
    if unsafe { GetSystemMetrics(SM_CMONITORS) } != 1 {
        return validate_layout(&[]);
    }
    let (w, h) = enigo.main_display().map_err(|e| e.to_string())?;
    validate_layout(&[(0, 0, w, h)])
}
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn display_size(_enigo: &Enigo) -> Result<(i32, i32), String> {
    Err("Controle nativo disponível apenas em Windows e Linux X11 nesta entrega".into())
}
struct Driver {
    enigo: Enigo,
    keys: Vec<Key>,
    buttons: Vec<Button>,
}
impl Driver {
    fn new() -> Result<Self, String> {
        if cfg!(target_os = "linux")
            && std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
        {
            return Err(
                "Controle nativo requer Linux X11; Wayland não é suportado nesta entrega".into(),
            );
        }
        let enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        display_size(&enigo)?;
        Ok(Self {
            enigo,
            keys: Vec::new(),
            buttons: Vec::new(),
        })
    }
    fn execute(&mut self, input: Input) -> Result<(), String> {
        if !input.valid() {
            return Err("Evento de entrada inválido".into());
        }
        let (w, h) = display_size(&self.enigo)?;
        let result = match input {
            Input::Move { x, y } => {
                self.enigo
                    .move_mouse(position(x, w), position(y, h), Coordinate::Abs)
            }
            Input::Button { button, down } => {
                let b = match button {
                    0 => Button::Left,
                    1 => Button::Middle,
                    _ => Button::Right,
                };
                if down {
                    if !self.buttons.contains(&b) {
                        self.buttons.push(b);
                    }
                } else {
                    self.buttons.retain(|v| *v != b);
                }
                self.enigo.button(
                    b,
                    if down {
                        Direction::Press
                    } else {
                        Direction::Release
                    },
                )
            }
            Input::Scroll { delta } => self.enigo.scroll(delta, Axis::Vertical),
            Input::Key { key, down } => {
                let k = native_key(&key).ok_or("Tecla não suportada")?;
                if down {
                    if !self.keys.contains(&k) {
                        self.keys.push(k);
                    }
                } else {
                    self.keys.retain(|v| *v != k);
                }
                self.enigo.key(
                    k,
                    if down {
                        Direction::Press
                    } else {
                        Direction::Release
                    },
                )
            }
        };
        result.map_err(|e| e.to_string())
    }
}
impl Drop for Driver {
    fn drop(&mut self) {
        for key in self.keys.drain(..) {
            let _ = self.enigo.key(key, Direction::Release);
        }
        for button in self.buttons.drain(..) {
            let _ = self.enigo.button(button, Direction::Release);
        }
    }
}
fn tcp(stream: &MaybeTlsStream<TcpStream>) -> Option<&TcpStream> {
    match stream {
        MaybeTlsStream::Plain(s) => Some(s),
        MaybeTlsStream::Rustls(s) => Some(&s.sock),
        _ => None,
    }
}
fn connection(url: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (mut socket, _) = tungstenite::connect(url)?;
    if let Some(tcp) = tcp(socket.get_ref()) {
        tcp.set_read_timeout(Some(Duration::from_secs(30)))?;
        tcp.set_write_timeout(Some(Duration::from_secs(3)))?;
    }
    socket.set_config(|config| {
        config.max_message_size = Some(65536);
        config.max_frame_size = Some(65536);
    });
    let code = uuid::Uuid::new_v4().simple().to_string();
    socket.send(Message::Text(
        json!({"type":"register","pairCode":code})
            .to_string()
            .into(),
    ))?;
    let mut grant = Grant::default();
    let mut driver: Option<Driver> = None;
    loop {
        match socket.read()? {
            Message::Text(text) => {
                let m: serde_json::Value = serde_json::from_str(&text)?;
                let session = m["sessionId"].as_str().unwrap_or("");
                match m["type"].as_str().unwrap_or("") {
                    "registered" => println!("\nACESSO REMOTO — código local: {code}\nInforme este código apenas no seu chamado para autorizar o controle.\n"),
                    "grant" if driver.is_none() && !session.is_empty() => {
                        match Driver::new() {
                            Ok(d) => { driver = Some(d); grant.session = session.into(); socket.send(Message::Text(json!({"type":"ready","sessionId":session}).to_string().into()))?; tracing::warn!("Controle remoto AUTORIZADO — sessão {session}"); }
                            Err(e) => socket.send(Message::Text(json!({"type":"error","sessionId":session,"error":e}).to_string().into()))?,
                        }
                    }
                    "revoke" if grant.allows(session) => { grant.session.clear(); driver = None; tracing::info!("Controle remoto revogado"); }
                    "input" if grant.allows(session) => {
                        let result = serde_json::from_value::<Input>(m["input"].clone()).map_err(|e| e.to_string())
                            .and_then(|input| driver.as_mut().ok_or("Sem autorização local".to_string())?.execute(input));
                        if let Err(e) = result {
                            grant.session.clear(); driver = None;
                            socket.send(Message::Text(json!({"type":"error","sessionId":session,"error":e}).to_string().into()))?;
                        }
                    }
                    _ => {}
                }
            }
            Message::Ping(_) => {
                socket.flush()?;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    // Driver::drop também libera as teclas se read/send falhar ou a conexão expirar.
    Ok(())
}
pub fn start() {
    if std::env::var("REMOTE_CONTROL_ENABLED").as_deref() != Ok("true") {
        return;
    }
    let url = std::env::var("SERVER_GO_REMOTE_WS_URL")
        .unwrap_or_else(|_| "ws://127.0.0.1:8081/api/remoto/agente/ws".into());
    std::thread::spawn(move || loop {
        if let Err(e) = connection(&url) {
            tracing::warn!("Conexão de acesso remoto encerrada: {e}");
        }
        std::thread::sleep(Duration::from_secs(3));
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_requires_current_grant() {
        let mut grant = Grant::default();
        assert!(!grant.allows("session-a"));
        grant.session = "session-a".into();
        assert!(grant.allows("session-a"));
        assert!(!grant.allows("session-b"));
        grant.session.clear();
        assert!(!grant.allows("session-a"));
    }
    #[test]
    fn rejects_unbounded_or_unknown_input() {
        assert!(!Input::Move {
            x: f64::NAN,
            y: 0.5
        }
        .valid());
        assert!(!Input::Move { x: 1.1, y: 0.5 }.valid());
        assert!(!Input::Button {
            button: 7,
            down: true
        }
        .valid());
        assert!(!Input::Key {
            key: "shell".into(),
            down: true
        }
        .valid());
        assert!(Input::Key {
            key: "ArrowLeft".into(),
            down: true
        }
        .valid());
        assert!(Input::Key {
            key: "ç".into(),
            down: true
        }
        .valid());
        assert!(serde_json::from_str::<Input>(r#"{"kind":"shell"}"#).is_err());
    }
    #[test]
    fn refuses_ambiguous_monitor_layouts() {
        assert!(validate_layout(&[(0, 0, 1920, 1080)]).is_ok());
        assert!(validate_layout(&[(1920, 0, 1920, 1080)]).is_err());
        assert!(validate_layout(&[(0, 0, 1920, 1080), (1920, 0, 1920, 1080)]).is_err());
        assert!(validate_layout(&[]).is_err());
    }
    #[test]
    fn maps_coordinates_to_last_pixel() {
        assert_eq!(position(1.0, 1920), 1919);
        assert_eq!(position(0.0, 1920), 0);
    }
}
