//! Controle remoto nativo (mouse/teclado via Enigo + Win32), captura multi-monitor de baixa latência,
//! persistência de senha no Registro do Windows (HKCU\Software\ServiceDesk\Agent) e notificações nativas.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
#[cfg(not(target_os = "windows"))]
use enigo::Coordinate;
use jpeg_encoder::{ColorType, Encoder};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    net::TcpStream,
    sync::mpsc,
    time::{Duration, Instant},
};
use tungstenite::{stream::MaybeTlsStream, Message};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonitorInfo {
    pub id: usize,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub primary: bool,
}

#[derive(Default)]
struct Grant {
    session: String,
}
impl Grant {
    fn allows(&self, session: &str) -> bool {
        !self.session.is_empty() && self.session == session
    }
}

#[derive(Debug, Clone, Deserialize)]
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
        "Space" | " " => Key::Space,
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

/// Gera uma senha aleatória legível de 8 caracteres alfanuméricos maiúsculos (ex: A7K9M2P4).
pub fn generate_random_password() -> String {
    let raw = uuid::Uuid::new_v4().simple().to_string().to_uppercase();
    raw.chars().take(8).collect()
}

#[cfg(target_os = "windows")]
mod win_platform {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{FALSE, LPARAM, RECT, TRUE},
            Graphics::Gdi::{
                BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
                EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject,
                SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, COLORONCOLOR,
                DIB_RGB_COLORS, HDC, HMONITOR, MONITORINFO, SRCCOPY,
            },
            System::Registry::{
                RegCloseKey, RegCreateKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
                HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
            },
            UI::WindowsAndMessaging::{GetSystemMetrics, SetCursorPos, SM_CXSCREEN, SM_CYSCREEN},
        },
    };

    const REG_SUBKEY: &str = "Software\\ServiceDesk\\Agent\0";
    const REG_VAL_PASS: &str = "RemotePassword\0";

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    pub fn read_registry_password() -> Option<String> {
        unsafe {
            let subkey = to_wide(REG_SUBKEY);
            let val_name = to_wide(REG_VAL_PASS);
            let mut hkey: HKEY = null_mut();
            let mut disp: u32 = 0;
            let status = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_READ | KEY_WRITE,
                null(),
                &mut hkey,
                &mut disp,
            );
            if status != 0 {
                return None;
            }
            let mut buf = [0u16; 128];
            let mut buf_bytes = (buf.len() * 2) as u32;
            let mut reg_type: u32 = 0;
            let q_status = RegQueryValueExW(
                hkey,
                val_name.as_ptr(),
                null(),
                &mut reg_type,
                buf.as_mut_ptr() as *mut u8,
                &mut buf_bytes,
            );
            RegCloseKey(hkey);
            if q_status != 0 || reg_type != REG_SZ || buf_bytes < 2 {
                return None;
            }
            let u16_len = (buf_bytes as usize / 2).saturating_sub(1);
            let s = String::from_utf16_lossy(&buf[..u16_len]).trim().to_string();
            if s.len() >= 4 {
                Some(s)
            } else {
                None
            }
        }
    }

    pub fn write_registry_password(password: &str) -> Result<(), String> {
        let trimmed = password.trim();
        if trimmed.len() < 4 {
            return Err("A senha deve ter pelo menos 4 caracteres".into());
        }
        unsafe {
            let subkey = to_wide(REG_SUBKEY);
            let val_name = to_wide(REG_VAL_PASS);
            let mut hkey: HKEY = null_mut();
            let mut disp: u32 = 0;
            let status = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_READ | KEY_WRITE,
                null(),
                &mut hkey,
                &mut disp,
            );
            if status != 0 {
                return Err(format!("Falha ao abrir chave no Registro do Windows (código {status})"));
            }
            let mut wide_val: Vec<u16> = trimmed.encode_utf16().collect();
            wide_val.push(0);
            let set_status = RegSetValueExW(
                hkey,
                val_name.as_ptr(),
                0,
                REG_SZ,
                wide_val.as_ptr() as *const u8,
                (wide_val.len() * 2) as u32,
            );
            RegCloseKey(hkey);
            if set_status != 0 {
                return Err(format!("Falha ao gravar senha no Registro do Windows (código {set_status})"));
            }
            Ok(())
        }
    }

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _lprect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let list = &mut *(lparam as *mut Vec<MonitorInfo>);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmonitor, &mut mi) != FALSE {
            let w = mi.rcMonitor.right - mi.rcMonitor.left;
            let h = mi.rcMonitor.bottom - mi.rcMonitor.top;
            let primary = (mi.dwFlags & 1) != 0;
            if w > 0 && h > 0 {
                let idx = list.len();
                list.push(MonitorInfo {
                    id: idx,
                    name: String::new(),
                    x: mi.rcMonitor.left,
                    y: mi.rcMonitor.top,
                    width: w,
                    height: h,
                    primary,
                });
            }
        }
        TRUE
    }

    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
        let mut raw: Vec<MonitorInfo> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                null_mut(),
                null(),
                Some(monitor_enum_proc),
                &mut raw as *mut Vec<MonitorInfo> as LPARAM,
            );
            if raw.is_empty() {
                let w = GetSystemMetrics(SM_CXSCREEN).max(1);
                let h = GetSystemMetrics(SM_CYSCREEN).max(1);
                raw.push(MonitorInfo {
                    id: 0,
                    name: "Monitor 1 (Principal)".into(),
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    primary: true,
                });
            }
        }
        // Ordena: monitor principal primeiro, depois por coordenada X
        raw.sort_by(|a, b| b.primary.cmp(&a.primary).then_with(|| a.x.cmp(&b.x)));
        for (i, m) in raw.iter_mut().enumerate() {
            m.id = i;
            m.name = if m.primary {
                format!("Monitor {} • Principal ({}x{})", i + 1, m.width, m.height)
            } else {
                format!("Monitor {} ({}x{})", i + 1, m.width, m.height)
            };
        }
        raw
    }

    pub fn move_cursor_abs(x: i32, y: i32) {
        unsafe {
            SetCursorPos(x, y);
        }
    }

    pub fn capture_monitor_bgra(
        mon: &MonitorInfo,
        target_w: i32,
        target_h: i32,
        out_bgra: &mut Vec<u8>,
    ) -> bool {
        unsafe {
            let hdc_screen = GetDC(null_mut());
            if hdc_screen.is_null() {
                return false;
            }
            let hdc_mem = CreateCompatibleDC(hdc_screen);
            if hdc_mem.is_null() {
                ReleaseDC(null_mut(), hdc_screen);
                return false;
            }
            let hbm = CreateCompatibleBitmap(hdc_screen, target_w, target_h);
            if hbm.is_null() {
                DeleteDC(hdc_mem);
                ReleaseDC(null_mut(), hdc_screen);
                return false;
            }
            let old_obj = SelectObject(hdc_mem, hbm as _);
            let ok = if target_w == mon.width && target_h == mon.height {
                BitBlt(
                    hdc_mem,
                    0,
                    0,
                    target_w,
                    target_h,
                    hdc_screen,
                    mon.x,
                    mon.y,
                    SRCCOPY,
                ) != FALSE
            } else {
                SetStretchBltMode(hdc_mem, COLORONCOLOR);
                StretchBlt(
                    hdc_mem,
                    0,
                    0,
                    target_w,
                    target_h,
                    hdc_screen,
                    mon.x,
                    mon.y,
                    mon.width,
                    mon.height,
                    SRCCOPY,
                ) != FALSE
            };

            if !ok {
                SelectObject(hdc_mem, old_obj);
                DeleteObject(hbm as _);
                DeleteDC(hdc_mem);
                ReleaseDC(null_mut(), hdc_screen);
                return false;
            }

            let len = (target_w as usize) * (target_h as usize) * 4;
            if out_bgra.len() != len {
                out_bgra.resize(len, 0);
            }

            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: target_w,
                    biHeight: -target_h, // top-down DIB
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [ std::mem::zeroed() ],
            };

            let lines = GetDIBits(
                hdc_mem,
                hbm,
                0,
                target_h as u32,
                out_bgra.as_mut_ptr() as *mut _,
                &mut bi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm as _);
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);

            lines > 0
        }
    }

    pub fn notify_os(title: &str, message: &str) {
        let t = title.replace('\'', "");
        let m = message.replace('\'', "");
        std::thread::spawn(move || {
            let script = format!(
                "Add-Type -AssemblyName System.Windows.Forms; \
                 Add-Type -AssemblyName System.Drawing; \
                 $n = New-Object System.Windows.Forms.NotifyIcon; \
                 $n.Icon = [System.Drawing.SystemIcons]::Information; \
                 $n.BalloonTipIcon = 'Info'; \
                 $n.BalloonTipTitle = '{t}'; \
                 $n.BalloonTipText = '{m}'; \
                 $n.Visible = $true; \
                 $n.ShowBalloonTip(5000); \
                 Start-Sleep -Seconds 5; \
                 $n.Dispose();"
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
                .spawn();
        });
    }
}

#[cfg(not(target_os = "windows"))]
mod win_platform {
    use super::*;

    fn password_file() -> std::path::PathBuf {
        std::env::temp_dir().join("servicedesk_remote_password.txt")
    }

    pub fn read_registry_password() -> Option<String> {
        let s = std::fs::read_to_string(password_file()).ok()?;
        let t = s.trim().to_string();
        if t.len() >= 4 {
            Some(t)
        } else {
            None
        }
    }

    pub fn write_registry_password(password: &str) -> Result<(), String> {
        let t = password.trim();
        if t.len() < 4 {
            return Err("A senha deve ter pelo menos 4 caracteres".into());
        }
        std::fs::write(password_file(), t).map_err(|e| e.to_string())
    }

    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
        #[cfg(target_os = "linux")]
        {
            use x11rb::{connection::Connection, protocol::randr::ConnectionExt};
            if let Ok((connection, screen)) = x11rb::connect(None) {
                if let Ok(req) = connection.randr_get_monitors(connection.setup().roots[screen].root, true) {
                    if let Ok(reply) = req.reply() {
                        let mut list: Vec<MonitorInfo> = reply
                            .monitors
                            .iter()
                            .enumerate()
                            .map(|(i, m)| MonitorInfo {
                                id: i,
                                name: format!("Monitor {} ({}x{})", i + 1, m.width, m.height),
                                x: m.x as i32,
                                y: m.y as i32,
                                width: m.width as i32,
                                height: m.height as i32,
                                primary: m.primary,
                            })
                            .collect();
                        if !list.is_empty() {
                            return list;
                        }
                    }
                }
            }
        }
        vec![MonitorInfo {
            id: 0,
            name: "Monitor 1 (Principal)".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            primary: true,
        }]
    }

    pub fn move_cursor_abs(_x: i32, _y: i32) {}

    pub fn capture_monitor_bgra(
        _mon: &MonitorInfo,
        _target_w: i32,
        _target_h: i32,
        _out_bgra: &mut Vec<u8>,
    ) -> bool {
        false
    }

    pub fn notify_os(title: &str, message: &str) {
        tracing::info!("[Notificação SO] {title}: {message}");
    }
}

pub fn load_or_create_password() -> String {
    if let Some(existing) = win_platform::read_registry_password() {
        return existing;
    }
    let generated = generate_random_password();
    let _ = win_platform::write_registry_password(&generated);
    generated
}

pub fn update_password(new_pass: &str) -> Result<String, String> {
    let final_pass = if new_pass.trim().is_empty() {
        generate_random_password()
    } else {
        new_pass.trim().to_string()
    };
    win_platform::write_registry_password(&final_pass)?;
    Ok(final_pass)
}

fn validate_layout(monitors: &[(i32, i32, i32, i32)]) -> Result<(i32, i32), String> {
    match monitors.first() {
        Some((_, _, w, h)) if *w > 0 && *h > 0 => Ok((*w, *h)),
        _ => Err("Nenhum monitor válido detectado.".into()),
    }
}

struct FrameCapturer {
    bgra_buf: Vec<u8>,
    rgb_buf: Vec<u8>,
    last_hash: u64,
    last_sent: Instant,
}

impl FrameCapturer {
    fn new() -> Self {
        Self {
            bgra_buf: Vec::new(),
            rgb_buf: Vec::new(),
            last_hash: 0,
            last_sent: Instant::now() - Duration::from_secs(10),
        }
    }

    fn capture_jpeg_base64(&mut self, mon: &MonitorInfo, force: bool) -> Option<String> {
        let max_w = 1366;
        let (target_w, target_h) = if mon.width > max_w {
            let scale = max_w as f64 / mon.width as f64;
            (max_w, ((mon.height as f64 * scale).round() as i32).max(1))
        } else {
            (mon.width.max(1), mon.height.max(1))
        };

        if !win_platform::capture_monitor_bgra(mon, target_w, target_h, &mut self.bgra_buf) {
            return None;
        }

        // Hash rápido amostrado para evitar re-enviar quadros idênticos sem necessidade
        let mut hash: u64 = 14695981039346656037;
        for chunk in self.bgra_buf.chunks(256) {
            hash ^= chunk[0] as u64;
            hash = hash.wrapping_mul(1099511628211);
        }

        if !force && hash == self.last_hash && self.last_sent.elapsed() < Duration::from_millis(800) {
            return None;
        }
        self.last_hash = hash;
        self.last_sent = Instant::now();

        let pixels = (target_w as usize) * (target_h as usize);
        if self.rgb_buf.len() != pixels * 3 {
            self.rgb_buf.resize(pixels * 3, 0);
        }
        for (bgra, rgb) in self.bgra_buf.chunks_exact(4).zip(self.rgb_buf.chunks_exact_mut(3)) {
            rgb[0] = bgra[2];
            rgb[1] = bgra[1];
            rgb[2] = bgra[0];
        }

        let mut jpeg_out = Vec::with_capacity(65536);
        let encoder = Encoder::new(&mut jpeg_out, 68);
        encoder
            .encode(&self.rgb_buf, target_w as u16, target_h as u16, ColorType::Rgb)
            .ok()?;

        Some(BASE64.encode(&jpeg_out))
    }
}

struct Driver {
    enigo: Enigo,
    monitors: Vec<MonitorInfo>,
    active_monitor: usize,
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
        let monitors = win_platform::enumerate_monitors();
        if monitors.is_empty() {
            return Err("Nenhum monitor encontrado".into());
        }
        Ok(Self {
            enigo,
            monitors,
            active_monitor: 0,
            keys: Vec::new(),
            buttons: Vec::new(),
        })
    }

    fn current_monitor(&self) -> &MonitorInfo {
        self.monitors
            .get(self.active_monitor)
            .unwrap_or(&self.monitors[0])
    }

    fn select_monitor(&mut self, id: usize) -> &MonitorInfo {
        let fresh = win_platform::enumerate_monitors();
        if !fresh.is_empty() {
            self.monitors = fresh;
        }
        if id < self.monitors.len() {
            self.active_monitor = id;
        }
        self.current_monitor()
    }

    fn execute(&mut self, input: Input) -> Result<(), String> {
        if !input.valid() {
            return Err("Evento de entrada inválido".into());
        }
        let mon = self.current_monitor().clone();
        let result = match input {
            Input::Move { x, y } => {
                let target_x = mon.x + position(x, mon.width);
                let target_y = mon.y + position(y, mon.height);
                #[cfg(target_os = "windows")]
                {
                    win_platform::move_cursor_abs(target_x, target_y);
                    Ok(())
                }
                #[cfg(not(target_os = "windows"))]
                {
                    self.enigo
                        .move_mouse(target_x, target_y, Coordinate::Abs)
                }
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

fn connection(url: &str, machine_uid: &str, hostname: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (mut socket, _) = tungstenite::connect(url)?;
    if let Some(tcp_stream) = tcp(socket.get_ref()) {
        // Desabilita o algoritmo de Nagle para resposta imediata de mouse/teclado (< 1ms)
        let _ = tcp_stream.set_nodelay(true);
        tcp_stream.set_read_timeout(Some(Duration::from_millis(12)))?;
        tcp_stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    }
    socket.set_config(|config| {
        config.max_message_size = Some(4 * 1024 * 1024);
        config.max_frame_size = Some(4 * 1024 * 1024);
    });

    let code = uuid::Uuid::new_v4().simple().to_string();
    let mut password = load_or_create_password();
    let monitors = win_platform::enumerate_monitors();

    socket.send(Message::Text(
        json!({
            "type": "register",
            "pairCode": code,
            "machineUid": machine_uid,
            "hostname": hostname,
            "password": password,
            "monitors": monitors,
        })
        .to_string()
        .into(),
    ))?;

    let mut grant = Grant::default();
    let mut driver: Option<Driver> = None;
    let mut capturer = FrameCapturer::new();
    let mut last_frame_at = Instant::now() - Duration::from_secs(1);
    let mut force_next_frame = true;

    loop {
        // 1. Drena todos os eventos recebidos e faz coalescing de movimentos de mouse acumulados
        let mut pending_move: Option<(String, Input)> = None;
        loop {
            match socket.read() {
                Ok(Message::Text(text)) => {
                    let m: serde_json::Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let session = m["sessionId"].as_str().unwrap_or("").to_string();
                    match m["type"].as_str().unwrap_or("") {
                        "registered" => {
                            println!(
                                "\n============================================================\n\
                                 ACESSO REMOTO ATIVO — Estação: {hostname} ({machine_uid})\n\
                                 Senha de Acesso Remoto (Salva no Registro): {password}\n\
                                 Chave: HKEY_CURRENT_USER\\Software\\ServiceDesk\\Agent\\RemotePassword\n\
                                 Monitores detectados: {}\n\
                                 ============================================================\n",
                                monitors.len()
                            );
                        }
                        "set_password" => {
                            let requested = m["password"].as_str().unwrap_or("");
                            match update_password(requested) {
                                Ok(new_pass) => {
                                    password = new_pass.clone();
                                    tracing::info!("Senha de acesso remoto atualizada no Registro do Windows: {password}");
                                    win_platform::notify_os(
                                        "ServiceDesk — Senha Remota Alterada",
                                        "A senha de acesso remoto desta estação foi atualizada pelo administrador.",
                                    );
                                    socket.send(Message::Text(
                                        json!({
                                            "type": "password_updated",
                                            "machineUid": machine_uid,
                                            "password": password,
                                        })
                                        .to_string()
                                        .into(),
                                    ))?;
                                }
                                Err(e) => {
                                    socket.send(Message::Text(
                                        json!({
                                            "type": "error",
                                            "error": e,
                                        })
                                        .to_string()
                                        .into(),
                                    ))?;
                                }
                            }
                        }
                        "grant" if !session.is_empty() => {
                            let tech_name = m["technicianName"].as_str().unwrap_or("Técnico");
                            match Driver::new() {
                                Ok(d) => {
                                    let mons = d.monitors.clone();
                                    let active = d.active_monitor;
                                    driver = Some(d);
                                    grant.session = session.clone();
                                    force_next_frame = true;
                                    socket.send(Message::Text(
                                        json!({
                                            "type": "ready",
                                            "sessionId": session,
                                            "monitors": mons,
                                            "activeMonitor": active,
                                        })
                                        .to_string()
                                        .into(),
                                    ))?;
                                    tracing::warn!("Acesso remoto INICIADO por {tech_name} — sessão {session}");
                                    win_platform::notify_os(
                                        "ServiceDesk — Acesso Remoto em Andamento",
                                        &format!("O técnico {tech_name} conectou remotamente a esta máquina."),
                                    );
                                }
                                Err(e) => {
                                    socket.send(Message::Text(
                                        json!({"type": "error", "sessionId": session, "error": e})
                                            .to_string()
                                            .into(),
                                    ))?;
                                }
                            }
                        }
                        "select_monitor" if grant.allows(&session) => {
                            if let Some(d) = driver.as_mut() {
                                let monitor_id = m["monitorId"].as_u64().unwrap_or(0) as usize;
                                let mon = d.select_monitor(monitor_id).clone();
                                force_next_frame = true;
                                socket.send(Message::Text(
                                    json!({
                                        "type": "monitor_selected",
                                        "sessionId": session,
                                        "activeMonitor": mon.id,
                                        "monitors": d.monitors,
                                    })
                                    .to_string()
                                    .into(),
                                ))?;
                            }
                        }
                        "revoke" if grant.allows(&session) => {
                            grant.session.clear();
                            driver = None;
                            tracing::info!("Acesso remoto encerrado");
                            win_platform::notify_os(
                                "ServiceDesk — Acesso Remoto Encerrado",
                                "A sessão de acesso remoto nesta máquina foi finalizada.",
                            );
                        }
                        "input" if grant.allows(&session) => {
                            match serde_json::from_value::<Input>(m["input"].clone()) {
                                Ok(Input::Move { x, y }) => {
                                    // Coalescing: guarda apenas o último Move da fila
                                    pending_move = Some((session, Input::Move { x, y }));
                                }
                                Ok(other_input) => {
                                    // Antes de clicar ou digitar, aplica o último Move pendente imediatamente
                                    if let Some((_, mv)) = pending_move.take() {
                                        if let Some(d) = driver.as_mut() {
                                            let _ = d.execute(mv);
                                        }
                                    }
                                    let res = driver
                                        .as_mut()
                                        .ok_or_else(|| "Sem autorização local".to_string())
                                        .and_then(|d| d.execute(other_input));
                                    if let Err(e) = res {
                                        socket.send(Message::Text(
                                            json!({"type": "error", "sessionId": session, "error": e})
                                                .to_string()
                                                .into(),
                                        ))?;
                                    }
                                }
                                Err(e) => {
                                    socket.send(Message::Text(
                                        json!({"type": "error", "sessionId": session, "error": e.to_string()})
                                            .to_string()
                                            .into(),
                                    ))?;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Message::Ping(_)) => {
                    socket.flush()?;
                }
                Ok(Message::Close(_)) => return Ok(()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(ref err))
                    if err.kind() == std::io::ErrorKind::WouldBlock
                        || err.kind() == std::io::ErrorKind::TimedOut =>
                {
                    break;
                }
                Err(e) => return Err(e.into()),
            }
        }

        // Executa o movimento de mouse mais recente coalescido
        if let Some((session, mv)) = pending_move.take() {
            if grant.allows(&session) {
                if let Some(d) = driver.as_mut() {
                    if let Err(e) = d.execute(mv) {
                        socket.send(Message::Text(
                            json!({"type": "error", "sessionId": session, "error": e})
                                .to_string()
                                .into(),
                        ))?;
                    }
                }
            }
        }

        // 2. Se houver sessão ativa, captura frame nativo do monitor selecionado (~25 FPS)
        if !grant.session.is_empty() && last_frame_at.elapsed() >= Duration::from_millis(38) {
            if let Some(d) = driver.as_ref() {
                let mon = d.current_monitor();
                if let Some(frame_b64) = capturer.capture_jpeg_base64(mon, force_next_frame) {
                    force_next_frame = false;
                    let _ = socket.send(Message::Text(
                        json!({
                            "type": "frame",
                            "sessionId": grant.session,
                            "monitorId": mon.id,
                            "width": mon.width,
                            "height": mon.height,
                            "frame": frame_b64,
                        })
                        .to_string()
                        .into(),
                    ));
                }
                last_frame_at = Instant::now();
            }
        }
    }
}

fn derive_remote_ws_url(grpc_url: &str) -> String {
    if let Ok(explicit) = std::env::var("SERVER_GO_REMOTE_WS_URL") {
        if !explicit.trim().is_empty() {
            return explicit;
        }
    }
    if let Ok(explicit2) = std::env::var("REMOTE_WS_URL") {
        if !explicit2.trim().is_empty() {
            return explicit2;
        }
    }
    // Extrai o IP/host do SERVER_GO_GRPC_URL (ex: http://192.168.1.10:50051 -> ws://192.168.1.10:8081/api/remoto/agente/ws)
    let stripped = grpc_url
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let host = stripped.split(':').next().unwrap_or("127.0.0.1");
    let host = host.split('/').next().unwrap_or("127.0.0.1");
    format!("ws://{host}:8081/api/remoto/agente/ws")
}

pub fn start(machine_uid: String, hostname: String, server_go_grpc_url: &str) {
    // Ativo por padrão, a menos que explicitamente desabilitado com REMOTE_CONTROL_ENABLED=false
    if std::env::var("REMOTE_CONTROL_ENABLED").as_deref() == Ok("false") {
        tracing::info!("Acesso remoto desabilitado via REMOTE_CONTROL_ENABLED=false");
        return;
    }
    let url = derive_remote_ws_url(server_go_grpc_url);
    let _ = mpsc::channel::<()>();
    std::thread::spawn(move || loop {
        if let Err(e) = connection(&url, &machine_uid, &hostname) {
            tracing::warn!("Conexão de acesso remoto encerrada ({url}): {e}");
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
    fn supports_multi_monitor_layouts() {
        assert!(validate_layout(&[(0, 0, 1920, 1080)]).is_ok());
        assert!(validate_layout(&[(0, 0, 1920, 1080), (1920, 0, 1920, 1080)]).is_ok());
        assert!(validate_layout(&[]).is_err());
    }
    #[test]
    fn maps_coordinates_to_last_pixel() {
        assert_eq!(position(1.0, 1920), 1919);
        assert_eq!(position(0.0, 1920), 0);
    }
    #[test]
    fn generates_and_persists_registry_password() {
        let pass = load_or_create_password();
        assert!(pass.len() >= 4);
    }
}
