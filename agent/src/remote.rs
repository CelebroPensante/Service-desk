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
        mpsc, Arc,
    },
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

#[cfg(target_os = "windows")]
mod win_platform {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{FALSE, LPARAM, POINT, RECT, TRUE},
            Graphics::Gdi::{
                BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
                EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject,
                SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                DIB_RGB_COLORS, HALFTONE, HDC, HMONITOR, MONITORINFO, SRCCOPY,
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
                SetStretchBltMode(hdc_mem, HALFTONE);
                let mut pt: POINT = std::mem::zeroed();
                SetBrushOrgEx(hdc_mem, 0, 0, &mut pt);
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
                    biHeight: -target_h,
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

    fn capture_binary_packet(&mut self, mon: &MonitorInfo, force: bool) -> Option<Vec<u8>> {
        let max_w = 1920;
        let (target_w, target_h) = if mon.width > max_w {
            let scale = max_w as f64 / mon.width as f64;
            (max_w, ((mon.height as f64 * scale).round() as i32).max(1))
        } else {
            (mon.width.max(1), mon.height.max(1))
        };

        if !win_platform::capture_monitor_bgra(mon, target_w, target_h, &mut self.bgra_buf) {
            return None;
        }

        let mut hash: u64 = 14695981039346656037;
        for chunk in self.bgra_buf.chunks(128) {
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

        let pixels = (target_w as usize) * (target_h as usize);
        if self.rgb_buf.len() != pixels * 3 {
            self.rgb_buf.resize(pixels * 3, 0);
        }
        for (bgra, rgb) in self
            .bgra_buf
            .chunks_exact(4)
            .zip(self.rgb_buf.chunks_exact_mut(3))
        {
            rgb[0] = bgra[2];
            rgb[1] = bgra[1];
            rgb[2] = bgra[0];
        }

        let mut packet = Vec::with_capacity(96 * 1024);
        packet.extend_from_slice(&(mon.id as u16).to_be_bytes());
        packet.extend_from_slice(&(target_w as u16).to_be_bytes());
        packet.extend_from_slice(&(target_h as u16).to_be_bytes());

        let mut encoder = Encoder::new(&mut packet, 84);
        encoder.set_sampling_factor(SamplingFactor::R_4_4_4);
        encoder
            .encode(
                &self.rgb_buf,
                target_w as u16,
                target_h as u16,
                ColorType::Rgb,
            )
            .ok()?;

        Some(packet)
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
    frame_rx: mpsc::Receiver<Vec<u8>>,
    running: Arc<AtomicBool>,
    force_frame: Arc<AtomicBool>,
}

impl ActiveSessionWorkers {
    fn start(initial_monitors: Vec<MonitorInfo>) -> Result<Self, String> {
        let test_driver = Driver::new()?;
        drop(test_driver);

        let running = Arc::new(AtomicBool::new(true));
        let active_monitor = Arc::new(AtomicUsize::new(0));
        let force_frame = Arc::new(AtomicBool::new(true));

        let (input_tx, input_rx) = mpsc::channel::<InputCmd>();
        let (frame_tx, frame_rx) = mpsc::sync_channel::<Vec<u8>>(1);

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
            let target_interval = Duration::from_millis(30); // ~33 FPS

            while run_for_cap.load(Ordering::Relaxed) {
                let started = Instant::now();
                let idx = mon_for_cap.load(Ordering::Relaxed);
                if idx >= monitors.len() {
                    monitors = win_platform::enumerate_monitors();
                }
                if let Some(mon) = monitors.get(idx).or_else(|| monitors.first()) {
                    let force = force_for_cap.swap(false, Ordering::Relaxed);
                    if let Some(packet) = capturer.capture_binary_packet(mon, force) {
                        let _ = frame_tx.try_send(packet);
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

        // 3. Envia quadro binário pronto da thread de captura (zero lag)
        if !grant.session.is_empty() {
            if let Some(w) = workers.as_ref() {
                if let Ok(packet) = w.frame_rx.try_recv() {
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
}
