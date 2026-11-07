//! Controle remoto nativo de ultra-baixa latência (3 threads desacopladas: WebSocket I/O, Input Worker e Capture Worker),
//! captura 1:1 DPI-Aware com transporte binário WebSocket, multi-monitor e modelo de solicitação/permissão do usuário.

use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
#[cfg(not(target_os = "windows"))]
use enigo::Coordinate;
use jpeg_encoder::{ColorType, Encoder, SamplingFactor};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    net::TcpStream,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tungstenite::{stream::MaybeTlsStream, Message};

/// Intervalo alvo entre capturas (25 ms ≈ 40 FPS máximos).
const CAPTURE_INTERVAL_MS: u64 = 25;
/// Quantidade de threads de codificação JPEG paralelas.
const ENCODER_THREADS: usize = 2;
/// Qualidade JPEG. Com subamostragem 4:2:0 o quadro fica ~30% menor e codifica ~40% mais rápido que 84/4:4:4.
const JPEG_QUALITY: u8 = 80;
/// Quadros enviados e ainda não confirmados (`frame_ack`) pelo técnico. Evita acumular vídeo nos buffers
/// de rede, o que fazia a latência crescer sem limite em telas complexas.
const MAX_FRAMES_IN_FLIGHT: u32 = 2;
/// Sem confirmação nesse intervalo, os quadros pendentes são considerados perdidos e o envio é retomado.
const FRAME_ACK_TIMEOUT: Duration = Duration::from_secs(1);

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

#[cfg(target_os = "windows")]
mod win_platform {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{FALSE, LPARAM, POINT, RECT, TRUE},
            Graphics::Gdi::{
                BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject,
                EnumDisplayMonitors, GdiFlush, GetDC, GetMonitorInfoW, ReleaseDC, SelectObject,
                SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC, HGDIOBJ, HMONITOR, MONITORINFO, SRCCOPY,
            },
            UI::WindowsAndMessaging::{
                GetSystemMetrics, MessageBoxW, SetCursorPos, SetProcessDPIAware, IDYES,
                MB_ICONQUESTION, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO, SM_CXSCREEN, SM_CYSCREEN,
            },
        },
    };

    pub fn enable_dpi_awareness() {
        unsafe {
            SetProcessDPIAware();
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
        enable_dpi_awareness();
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

    /// Capturador persistente: mantém o DC de tela, o DC de memória e a DIB Section entre os quadros,
    /// evitando alocar e liberar um bitmap de ~8 MB por frame (principal gargalo de FPS do GDI).
    pub struct Grabber {
        hdc_screen: HDC,
        hdc_mem: HDC,
        hbm: HBITMAP,
        old_obj: HGDIOBJ,
        bits: *mut core::ffi::c_void,
        w: i32,
        h: i32,
    }

    impl Grabber {
        pub fn new() -> Self {
            Self {
                hdc_screen: null_mut(),
                hdc_mem: null_mut(),
                hbm: null_mut(),
                old_obj: null_mut(),
                bits: null_mut(),
                w: 0,
                h: 0,
            }
        }

        fn release_bitmap(&mut self) {
            unsafe {
                if !self.hdc_mem.is_null() && !self.old_obj.is_null() {
                    SelectObject(self.hdc_mem, self.old_obj);
                }
                if !self.hbm.is_null() {
                    DeleteObject(self.hbm as _);
                }
            }
            self.hbm = null_mut();
            self.old_obj = null_mut();
            self.bits = null_mut();
            self.w = 0;
            self.h = 0;
        }

        fn ensure(&mut self, w: i32, h: i32) -> bool {
            unsafe {
                if self.hdc_screen.is_null() {
                    self.hdc_screen = GetDC(null_mut());
                    if self.hdc_screen.is_null() {
                        return false;
                    }
                }
                if self.hdc_mem.is_null() {
                    self.hdc_mem = CreateCompatibleDC(self.hdc_screen);
                    if self.hdc_mem.is_null() {
                        return false;
                    }
                }
                if !self.hbm.is_null() && self.w == w && self.h == h {
                    return true;
                }
                self.release_bitmap();
                let bi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w,
                        biHeight: -h,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB,
                        biSizeImage: 0,
                        biXPelsPerMeter: 0,
                        biYPelsPerMeter: 0,
                        biClrUsed: 0,
                        biClrImportant: 0,
                    },
                    bmiColors: [std::mem::zeroed()],
                };
                let mut bits: *mut core::ffi::c_void = null_mut();
                let hbm = CreateDIBSection(
                    self.hdc_screen,
                    &bi,
                    DIB_RGB_COLORS,
                    &mut bits,
                    null_mut(),
                    0,
                );
                if hbm.is_null() || bits.is_null() {
                    return false;
                }
                self.old_obj = SelectObject(self.hdc_mem, hbm as _);
                self.hbm = hbm;
                self.bits = bits;
                self.w = w;
                self.h = h;
                true
            }
        }

        /// Copia o monitor para `out` em BGRA (4 bytes/pixel), escalando apenas se necessário.
        pub fn capture(
            &mut self,
            mon: &MonitorInfo,
            target_w: i32,
            target_h: i32,
            out: &mut Vec<u8>,
        ) -> bool {
            if !self.ensure(target_w, target_h) {
                return false;
            }
            unsafe {
                let ok = if target_w == mon.width && target_h == mon.height {
                    BitBlt(
                        self.hdc_mem,
                        0,
                        0,
                        target_w,
                        target_h,
                        self.hdc_screen,
                        mon.x,
                        mon.y,
                        SRCCOPY,
                    ) != FALSE
                } else {
                    SetStretchBltMode(self.hdc_mem, HALFTONE);
                    let mut pt: POINT = std::mem::zeroed();
                    SetBrushOrgEx(self.hdc_mem, 0, 0, &mut pt);
                    StretchBlt(
                        self.hdc_mem,
                        0,
                        0,
                        target_w,
                        target_h,
                        self.hdc_screen,
                        mon.x,
                        mon.y,
                        mon.width,
                        mon.height,
                        SRCCOPY,
                    ) != FALSE
                };
                if !ok {
                    return false;
                }
                GdiFlush();
                let len = (target_w as usize) * (target_h as usize) * 4;
                out.clear();
                out.extend_from_slice(std::slice::from_raw_parts(self.bits as *const u8, len));
                true
            }
        }
    }

    impl Drop for Grabber {
        fn drop(&mut self) {
            self.release_bitmap();
            unsafe {
                if !self.hdc_mem.is_null() {
                    DeleteDC(self.hdc_mem);
                }
                if !self.hdc_screen.is_null() {
                    ReleaseDC(null_mut(), self.hdc_screen);
                }
            }
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

    /// Exibe uma janela nativa do Windows perguntando ao usuário da estação se ele permite o acesso remoto.
    pub fn ask_user_consent(tech_name: &str) -> bool {
        let title: Vec<u16> = "ServiceDesk — Solicitação de Acesso Remoto\0"
            .encode_utf16()
            .collect();
        let body: Vec<u16> = format!(
            "O técnico {tech_name} está solicitando permissão para acessar e controlar esta máquina remotamente.\n\nDeseja autorizar o acesso remoto agora?\0"
        )
        .encode_utf16()
        .collect();
        unsafe {
            let res = MessageBoxW(
                null_mut(),
                body.as_ptr(),
                title.as_ptr(),
                MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND,
            );
            res == IDYES
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_platform {
    use super::*;

    pub fn enable_dpi_awareness() {}

    pub fn enumerate_monitors() -> Vec<MonitorInfo> {
        #[cfg(target_os = "linux")]
        {
            use x11rb::{connection::Connection, protocol::randr::ConnectionExt};
            if let Ok((connection, screen)) = x11rb::connect(None) {
                if let Ok(req) =
                    connection.randr_get_monitors(connection.setup().roots[screen].root, true)
                {
                    if let Ok(reply) = req.reply() {
                        let list: Vec<MonitorInfo> = reply
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

    pub struct Grabber;

    impl Grabber {
        pub fn new() -> Self {
            Self
        }

        pub fn capture(
            &mut self,
            _mon: &MonitorInfo,
            _target_w: i32,
            _target_h: i32,
            _out: &mut Vec<u8>,
        ) -> bool {
            false
        }
    }

    pub fn notify_os(title: &str, message: &str) {
        tracing::info!("[Notificação SO] {title}: {message}");
    }

    pub fn ask_user_consent(_tech_name: &str) -> bool {
        true
    }
}

#[cfg(test)]
fn validate_layout(monitors: &[(i32, i32, i32, i32)]) -> Result<(i32, i32), String> {
    match monitors.first() {
        Some((_, _, w, h)) if *w > 0 && *h > 0 => Ok((*w, *h)),
        _ => Err("Nenhum monitor válido detectado.".into()),
    }
}

/// Quadro bruto (BGRA) capturado da tela, aguardando codificação JPEG.
struct RawFrame {
    seq: u64,
    mon_id: usize,
    width: i32,
    height: i32,
    bgra: Vec<u8>,
}

struct FrameCapturer {
    grabber: win_platform::Grabber,
    last_hash: u64,
    last_sent: Instant,
    seq: u64,
}

impl FrameCapturer {
    fn new() -> Self {
        Self {
            grabber: win_platform::Grabber::new(),
            last_hash: 0,
            last_sent: Instant::now() - Duration::from_secs(10),
            seq: 0,
        }
    }

    /// Captura o monitor reaproveitando o buffer `buf`; devolve `None` quando a tela não mudou.
    fn capture_raw(&mut self, mon: &MonitorInfo, force: bool, buf: &mut Vec<u8>) -> Option<RawFrame> {
        let max_w = 1920;
        let (target_w, target_h) = if mon.width > max_w {
            let scale = max_w as f64 / mon.width as f64;
            (max_w, ((mon.height as f64 * scale).round() as i32).max(1))
        } else {
            (mon.width.max(1), mon.height.max(1))
        };

        if !self.grabber.capture(mon, target_w, target_h, buf) {
            return None;
        }

        let mut hash: u64 = 14695981039346656037;
        for chunk in buf.chunks(128) {
            hash ^= (chunk[0] as u64)
                | ((chunk[1] as u64) << 8)
                | ((chunk[2] as u64) << 16);
            hash = hash.wrapping_mul(1099511628211);
        }

        if !force && hash == self.last_hash && self.last_sent.elapsed() < Duration::from_millis(900)
        {
            return None;
        }
        self.last_hash = hash;
        self.last_sent = Instant::now();
        self.seq += 1;

        Some(RawFrame {
            seq: self.seq,
            mon_id: mon.id,
            width: target_w,
            height: target_h,
            bgra: std::mem::take(buf),
        })
    }
}

/// Codifica o quadro BGRA diretamente em JPEG (sem conversão intermediária para RGB) e monta o pacote binário:
/// [monitor_id u16][largura u16][altura u16][bytes JPEG].
fn encode_packet(frame: &RawFrame) -> Option<Vec<u8>> {
    let mut packet = Vec::with_capacity(192 * 1024);
    packet.extend_from_slice(&(frame.mon_id as u16).to_be_bytes());
    packet.extend_from_slice(&(frame.width as u16).to_be_bytes());
    packet.extend_from_slice(&(frame.height as u16).to_be_bytes());

    let mut encoder = Encoder::new(&mut packet, JPEG_QUALITY);
    encoder.set_sampling_factor(SamplingFactor::R_4_2_0);
    encoder
        .encode(
            &frame.bgra,
            frame.width as u16,
            frame.height as u16,
            ColorType::Bgra,
        )
        .ok()?;

    Some(packet)
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
                    self.enigo.move_mouse(target_x, target_y, Coordinate::Abs)
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

enum InputCmd {
    Exec(Input),
    SelectMonitor(usize),
    Stop,
}

struct ActiveSessionWorkers {
    input_tx: mpsc::Sender<InputCmd>,
    frame_rx: mpsc::Receiver<(u64, Vec<u8>)>,
    running: Arc<AtomicBool>,
    force_frame: Arc<AtomicBool>,
    last_seq: u64,
    /// Quadro mais recente já codificado, aguardando espaço na janela de envio.
    pending: Option<(u64, Vec<u8>)>,
    in_flight: u32,
    last_ack: Instant,
}

impl ActiveSessionWorkers {
    fn ack_frame(&mut self) {
        self.in_flight = self.in_flight.saturating_sub(1);
        self.last_ack = Instant::now();
    }

    /// Guarda só o quadro mais novo e o entrega quando o técnico tiver confirmado os anteriores.
    fn next_frame(&mut self) -> Option<Vec<u8>> {
        while let Ok(item) = self.frame_rx.try_recv() {
            if item.0 > self.last_seq && self.pending.as_ref().map_or(true, |(seq, _)| item.0 > *seq) {
                self.pending = Some(item);
            }
        }
        if self.in_flight >= MAX_FRAMES_IN_FLIGHT {
            if self.last_ack.elapsed() < FRAME_ACK_TIMEOUT {
                return None;
            }
            self.in_flight = 0;
        }
        let (seq, packet) = self.pending.take()?;
        self.last_seq = seq;
        if self.in_flight == 0 {
            self.last_ack = Instant::now();
        }
        self.in_flight += 1;
        Some(packet)
    }
}

impl ActiveSessionWorkers {
    fn start(initial_monitors: Vec<MonitorInfo>) -> Result<Self, String> {
        let test_driver = Driver::new()?;
        drop(test_driver);

        let running = Arc::new(AtomicBool::new(true));
        let active_monitor = Arc::new(AtomicUsize::new(0));
        let force_frame = Arc::new(AtomicBool::new(true));

        let (input_tx, input_rx) = mpsc::channel::<InputCmd>();
        let (frame_tx, frame_rx) = mpsc::sync_channel::<(u64, Vec<u8>)>(3);
        let (raw_tx, raw_rx) = mpsc::sync_channel::<RawFrame>(ENCODER_THREADS);
        let raw_rx = Arc::new(Mutex::new(raw_rx));
        let (pool_tx, pool_rx) = mpsc::channel::<Vec<u8>>();

        // Pool de codificadores JPEG em paralelo: enquanto um quadro é comprimido, o próximo já é capturado/comprimido
        for _ in 0..ENCODER_THREADS {
            let rx = raw_rx.clone();
            let out = frame_tx.clone();
            let recycle = pool_tx.clone();
            let run = running.clone();
            std::thread::spawn(move || {
                while run.load(Ordering::Relaxed) {
                    let received = {
                        let guard = match rx.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        guard.recv_timeout(Duration::from_millis(100))
                    };
                    let frame = match received {
                        Ok(f) => f,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    };
                    if let Some(packet) = encode_packet(&frame) {
                        let _ = out.try_send((frame.seq, packet));
                    }
                    let _ = recycle.send(frame.bgra);
                }
            });
        }

        let mon_for_input = active_monitor.clone();
        let run_for_input = running.clone();
        std::thread::spawn(move || {
            let mut driver = match Driver::new() {
                Ok(d) => d,
                Err(_) => return,
            };
            while run_for_input.load(Ordering::Relaxed) {
                let first = match input_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(cmd) => cmd,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                };

                let mut pending_move: Option<Input> = None;
                let process_cmd = |cmd: InputCmd, d: &mut Driver, pm: &mut Option<Input>| -> bool {
                    match cmd {
                        InputCmd::Exec(Input::Move { x, y }) => {
                            *pm = Some(Input::Move { x, y });
                            true
                        }
                        InputCmd::Exec(other) => {
                            if let Some(mv) = pm.take() {
                                let _ = d.execute(mv);
                            }
                            let _ = d.execute(other);
                            true
                        }
                        InputCmd::SelectMonitor(id) => {
                            let mon = d.select_monitor(id);
                            mon_for_input.store(mon.id, Ordering::Relaxed);
                            true
                        }
                        InputCmd::Stop => false,
                    }
                };

                if !process_cmd(first, &mut driver, &mut pending_move) {
                    break;
                }
                while let Ok(next_cmd) = input_rx.try_recv() {
                    if !process_cmd(next_cmd, &mut driver, &mut pending_move) {
                        return;
                    }
                }
                if let Some(mv) = pending_move.take() {
                    let _ = driver.execute(mv);
                }
            }
        });

        let mon_for_cap = active_monitor.clone();
        let run_for_cap = running.clone();
        let force_for_cap = force_frame.clone();
        std::thread::spawn(move || {
            let mut capturer = FrameCapturer::new();
            let mut monitors = if initial_monitors.is_empty() {
                win_platform::enumerate_monitors()
            } else {
                initial_monitors
            };
            let target_interval = Duration::from_millis(CAPTURE_INTERVAL_MS);
            let mut spare: Vec<u8> = Vec::new();

            while run_for_cap.load(Ordering::Relaxed) {
                let started = Instant::now();
                let idx = mon_for_cap.load(Ordering::Relaxed);
                if idx >= monitors.len() {
                    monitors = win_platform::enumerate_monitors();
                }
                if let Some(mon) = monitors.get(idx).or_else(|| monitors.first()) {
                    if spare.capacity() == 0 {
                        if let Ok(recycled) = pool_rx.try_recv() {
                            spare = recycled;
                        }
                    }
                    let force = force_for_cap.swap(false, Ordering::Relaxed);
                    if let Some(frame) = capturer.capture_raw(mon, force, &mut spare) {
                        // Se todos os codificadores estão ocupados o quadro é descartado (backpressure)
                        let _ = raw_tx.try_send(frame);
                    }
                }
                let elapsed = started.elapsed();
                if elapsed < target_interval {
                    std::thread::sleep(target_interval - elapsed);
                }
            }
        });

        Ok(Self {
            input_tx,
            frame_rx,
            running,
            force_frame,
            last_seq: 0,
            pending: None,
            in_flight: 0,
            last_ack: Instant::now(),
        })
    }

    fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        let _ = self.input_tx.send(InputCmd::Stop);
    }
}

impl Drop for ActiveSessionWorkers {
    fn drop(&mut self) {
        self.stop();
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
    win_platform::enable_dpi_awareness();
    let (mut socket, _) = tungstenite::connect(url)?;
    if let Some(tcp_stream) = tcp(socket.get_ref()) {
        let _ = tcp_stream.set_nodelay(true);
        tcp_stream.set_read_timeout(Some(Duration::from_millis(2)))?;
        tcp_stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    }
    socket.set_config(|config| {
        config.max_message_size = Some(8 * 1024 * 1024);
        config.max_frame_size = Some(8 * 1024 * 1024);
    });

    let code = uuid::Uuid::new_v4().simple().to_string();
    let mut monitors = win_platform::enumerate_monitors();

    socket.send(Message::Text(
        json!({
            "type": "register",
            "pairCode": code,
            "machineUid": machine_uid,
            "hostname": hostname,
            "monitors": monitors,
        })
        .to_string()
        .into(),
    ))?;

    let mut grant = Grant::default();
    let mut workers: Option<ActiveSessionWorkers> = None;
    let (consent_tx, consent_rx) = mpsc::channel::<(String, String, bool)>();

    loop {
        // 1. Verifica se o usuário respondeu à caixa de diálogo nativa de permissão
        while let Ok((session_id, tech_name, accepted)) = consent_rx.try_recv() {
            if grant.allows(&session_id) {
                continue;
            }
            if accepted {
                monitors = win_platform::enumerate_monitors();
                match ActiveSessionWorkers::start(monitors.clone()) {
                    Ok(w) => {
                        workers = Some(w);
                        grant.session = session_id.clone();
                        socket.send(Message::Text(
                            json!({
                                "type": "ready",
                                "sessionId": session_id,
                                "monitors": monitors,
                                "activeMonitor": 0,
                            })
                            .to_string()
                            .into(),
                        ))?;
                        win_platform::notify_os(
                            "ServiceDesk — Acesso Remoto em Andamento",
                            &format!("O técnico {tech_name} está conectado a esta máquina."),
                        );
                    }
                    Err(e) => {
                        socket.send(Message::Text(
                            json!({"type": "error", "sessionId": session_id, "error": e})
                                .to_string()
                                .into(),
                        ))?;
                    }
                }
            } else {
                socket.send(Message::Text(
                    json!({
                        "type": "consent_denied",
                        "sessionId": session_id,
                        "error": "O usuário da estação recusou a solicitação de acesso remoto."
                    })
                    .to_string()
                    .into(),
                ))?;
            }
        }

        // 2. Lê comandos do servidor sem bloquear nas capturas de vídeo
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
                                 Modo: Solicitação e Permissão do Usuário\n\
                                 Monitores detectados (1:1 Full HD): {}\n\
                                 ============================================================\n",
                                monitors.len()
                            );
                        }
                        "prompt_consent" if !session.is_empty() => {
                            let tech_name = m["technicianName"]
                                .as_str()
                                .unwrap_or("Técnico")
                                .to_string();
                            win_platform::notify_os(
                                "ServiceDesk — Solicitação de Acesso Remoto",
                                &format!("O técnico {tech_name} solicitou acesso remoto a esta estação."),
                            );
                            let tx = consent_tx.clone();
                            let sess_clone = session.clone();
                            std::thread::spawn(move || {
                                let accepted = win_platform::ask_user_consent(&tech_name);
                                let _ = tx.send((sess_clone, tech_name, accepted));
                            });
                        }
                        "grant" if !session.is_empty() => {
                            if grant.allows(&session) && workers.is_some() {
                                socket.send(Message::Text(
                                    json!({
                                        "type": "ready",
                                        "sessionId": session,
                                        "monitors": monitors,
                                        "activeMonitor": 0,
                                    })
                                    .to_string()
                                    .into(),
                                ))?;
                                continue;
                            }
                            let tech_name = m["technicianName"].as_str().unwrap_or("Técnico");
                            monitors = win_platform::enumerate_monitors();
                            match ActiveSessionWorkers::start(monitors.clone()) {
                                Ok(w) => {
                                    workers = Some(w);
                                    grant.session = session.clone();
                                    socket.send(Message::Text(
                                        json!({
                                            "type": "ready",
                                            "sessionId": session,
                                            "monitors": monitors,
                                            "activeMonitor": 0,
                                        })
                                        .to_string()
                                        .into(),
                                    ))?;
                                    tracing::warn!("Acesso remoto AUTORIZADO para {tech_name} — sessão {session}");
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
                        "ping" if grant.allows(&session) => {
                            socket.send(Message::Text(
                                json!({"type": "pong", "sessionId": session, "ts": m["ts"]})
                                    .to_string()
                                    .into(),
                            ))?;
                        }
                        "frame_ack" if grant.allows(&session) => {
                            if let Some(w) = workers.as_mut() {
                                w.ack_frame();
                            }
                        }
                        "select_monitor" if grant.allows(&session) => {
                            let monitor_id = m["monitorId"].as_u64().unwrap_or(0) as usize;
                            monitors = win_platform::enumerate_monitors();
                            let valid_id = if monitor_id < monitors.len() {
                                monitor_id
                            } else {
                                0
                            };
                            if let Some(w) = workers.as_ref() {
                                let _ = w.input_tx.send(InputCmd::SelectMonitor(valid_id));
                                w.force_frame.store(true, Ordering::Relaxed);
                            }
                            socket.send(Message::Text(
                                json!({
                                    "type": "monitor_selected",
                                    "sessionId": session,
                                    "activeMonitor": valid_id,
                                    "monitors": monitors,
                                })
                                .to_string()
                                .into(),
                            ))?;
                        }
                        "revoke" if grant.allows(&session) => {
                            grant.session.clear();
                            workers = None;
                            tracing::info!("Acesso remoto encerrado");
                            win_platform::notify_os(
                                "ServiceDesk — Acesso Remoto Encerrado",
                                "A sessão de acesso remoto nesta máquina foi finalizada.",
                            );
                        }
                        "input" if grant.allows(&session) => {
                            match serde_json::from_value::<Input>(m["input"].clone()) {
                                Ok(inp) if inp.valid() => {
                                    if let Some(w) = workers.as_ref() {
                                        let _ = w.input_tx.send(InputCmd::Exec(inp));
                                    }
                                }
                                _ => {
                                    socket.send(Message::Text(
                                        json!({"type": "error", "sessionId": session, "error": "Evento de entrada inválido"})
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

        // 3. Envia o quadro mais recente já codificado (descarta obsoletos e respeita a janela de confirmações)
        if !grant.session.is_empty() {
            if let Some(w) = workers.as_mut() {
                if let Some(packet) = w.next_frame() {
                    let _ = socket.send(Message::Binary(packet.into()));
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(15));
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
    let stripped = grpc_url
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let host = stripped.split(':').next().unwrap_or("127.0.0.1");
    let host = host.split('/').next().unwrap_or("127.0.0.1");
    format!("ws://{host}:8081/api/remoto/agente/ws")
}

pub fn start(machine_uid: String, hostname: String, server_go_grpc_url: &str) {
    if std::env::var("REMOTE_CONTROL_ENABLED").as_deref() == Ok("false") {
        tracing::info!("Acesso remoto desabilitado via REMOTE_CONTROL_ENABLED=false");
        return;
    }
    let url = derive_remote_ws_url(server_go_grpc_url);
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

    /// Benchmark manual: `cargo test bench_capture_encode -- --ignored --nocapture`
    /// Mede captura (quando há desktop interativo) e codificação JPEG (com imagem sintética se a captura não for possível).
    #[test]
    #[ignore]
    fn bench_capture_encode() {
        let monitors = win_platform::enumerate_monitors();
        let mon = monitors.first().expect("sem monitor").clone();
        let mut capturer = FrameCapturer::new();
        let mut spare = Vec::new();
        let (mut cap_ms, mut enc_ms, mut frames) = (0.0f64, 0.0f64, 0u32);
        for _ in 0..40 {
            let t = Instant::now();
            let frame = match capturer.capture_raw(&mon, true, &mut spare) {
                Some(f) => {
                    cap_ms += t.elapsed().as_secs_f64() * 1000.0;
                    f
                }
                None => {
                    // Sem acesso ao desktop (sessão não interativa): imagem sintética com texto/ruído leve
                    let (w, h) = (1920usize, 1080usize);
                    let mut bgra = vec![0u8; w * h * 4];
                    for (i, px) in bgra.chunks_exact_mut(4).enumerate() {
                        let (x, y) = (i % w, i / w);
                        let v = if (x / 6 + y / 11) % 3 == 0 { 20 } else { 235 };
                        px[0] = v;
                        px[1] = (x * 255 / w) as u8;
                        px[2] = (y * 255 / h) as u8;
                    }
                    RawFrame {
                        seq: 0,
                        mon_id: 0,
                        width: w as i32,
                        height: h as i32,
                        bgra,
                    }
                }
            };
            let t2 = Instant::now();
            let packet = encode_packet(&frame).expect("encode");
            enc_ms += t2.elapsed().as_secs_f64() * 1000.0;
            frames += 1;
            if frames == 1 {
                println!("tamanho do pacote: {} KB", packet.len() / 1024);
            }
            spare = frame.bgra;
        }
        println!(
            "{}x{} | captura média: {:.1} ms | codificação média: {:.1} ms",
            mon.width,
            mon.height,
            cap_ms / frames as f64,
            enc_ms / frames as f64
        );
    }
}
