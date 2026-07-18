use std::process::{Child, Command};
use std::sync::Mutex;
use std::{collections::{HashMap, HashSet}, path::PathBuf};
use std::panic;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;
use tauri::Emitter;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

/// Show/hide the Quick Capture window (⌥Space, tray menu).
fn toggle_capture_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

struct OllamaProcess(Mutex<Option<Child>>);

#[derive(Default)]
struct ClipperRuntime {
    server: Option<Arc<tiny_http::Server>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct ClipperServer(Mutex<ClipperRuntime>);

fn get_ollama_path() -> String {
    // 1. Check for bundled binary (highest priority for distribution)
    #[cfg(target_os = "macos")]
    {
        use std::path::Path;
        let bundled_path = Path::new("../ollama/ollama");
        if bundled_path.exists() {
            return bundled_path.to_string_lossy().into_owned();
        }
    }

    // 2. Check standard system paths
    let paths = [
        "ollama",
        "/usr/local/bin/ollama",
        "/opt/homebrew/bin/ollama",
        "/usr/bin/ollama",
    ];

    for path in paths {
        if Command::new(path).arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok() {
            return path.to_string();
        }
    }
    "ollama".to_string()
}

fn start_ollama_service(app: &tauri::AppHandle) {
    let ollama_path = get_ollama_path();
    // Only start Ollama if the port isn't already in use
    if std::net::TcpListener::bind("127.0.0.1:11434").is_ok() {
        // Spawn ollama serve in background
        let child = Command::new(&ollama_path)
            .arg("serve")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        match child {
            Ok(c) => {
                println!("[Nopes] ollama serve started (PID: {}) using path: {}", c.id(), ollama_path);
                *app.state::<OllamaProcess>().0.lock().unwrap() = Some(c);
            }
            Err(e) => {
                eprintln!("[Nopes] Failed to start ollama serve at {}: {}", ollama_path, e);
            }
        }
    } else {
        println!("[Nopes] Port 11434 in use, assuming Ollama is already running.");
    }
}

fn stop_ollama_service(app: &tauri::AppHandle) {
    let state = app.state::<OllamaProcess>();
    let child_opt = state.0.lock().ok().and_then(|mut g| g.take());
    if let Some(mut child) = child_opt {
        let _ = child.kill();
        println!("[Nopes] ollama serve stopped.");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Panic Logger (Grey-Screen Forensics) ──────────────────
    // If the Rust backend panics, this captures the stack trace
    // to a log file for post-mortem debugging.
    {
        let log_path = std::path::Path::new("nopes_crash.log");
        if let Ok(file) = OpenOptions::new().create(true).append(true).open(log_path) {
            let file = Mutex::new(file);
            panic::set_hook(Box::new(move |info| {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Ok(mut f) = file.lock() {
                    let _ = writeln!(f, "--- PANIC at {} ---\n{:?}\n", timestamp, info);
                }
                eprintln!("[NoPes:PANIC] {:?}", info);
            }));
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(OllamaProcess(Mutex::new(None)))
        .manage(ClipperServer(Mutex::new(ClipperRuntime::default())))
        .setup(move |app| {
            // Initial Ollama startup is handled by the frontend calling
            // manage_ollama(true) if AI is enabled in the user's settings.

            // ── Tray icon (Quick Capture entry point) ─────────────
            let open_item = MenuItem::with_id(app, "open", "Open NoPes", true, None::<&str>)?;
            let capture_item = MenuItem::with_id(app, "capture", "Quick Capture", true, Some("Alt+Space"))?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit NoPes", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &capture_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon().cloned() {
                TrayIconBuilder::with_id("nopes-tray")
                    .icon(icon)
                    .tooltip("NoPes")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "capture" => toggle_capture_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            // ── Global shortcut: ⌥Space toggles Quick Capture ─────
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app_handle, shortcut, event| {
                            if event.state() == ShortcutState::Pressed && shortcut == &alt_space {
                                toggle_capture_window(app_handle);
                            }
                        })
                        .build(),
                )?;
                if let Err(e) = app.global_shortcut().register(alt_space) {
                    // Non-fatal: another app may own ⌥Space; tray entry still works.
                    eprintln!("[Nopes] Could not register ⌥Space global shortcut: {}", e);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the MAIN window's lifecycle controls the app — the capture
            // window hides/shows constantly and must not kill Ollama.
            if window.label() != "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Closing the capture window just hides it.
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            match event {
                tauri::WindowEvent::Destroyed => {
                    stop_ollama_service(window.app_handle());
                    // The hidden capture window would keep the process alive
                    // forever — main window closing means quit.
                    window.app_handle().exit(0);
                }
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Also clean up Ollama on close request (catches cases where
                    // Destroyed doesn't fire, e.g. app crashes mid-transition)
                    stop_ollama_service(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![ensure_model, manage_ollama, get_system_stats, check_whisper, transcribe_audio, set_clipper, download_clip_images])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn manage_ollama(active: bool, app: tauri::AppHandle) -> Result<(), String> {
    if active {
        start_ollama_service(&app);
    } else {
        stop_ollama_service(&app);
    }
    Ok(())
}

#[tauri::command]
async fn get_system_stats() -> Result<serde_json::Value, String> {
    let processes = read_process_table()?;
    let by_pid: HashMap<u32, ProcessStat> = processes.iter().map(|p| (p.pid, p.clone())).collect();

    let app_pids = collect_descendants(std::process::id(), &processes);
    let app_rss_kb: u64 = app_pids
        .iter()
        .filter_map(|pid| by_pid.get(pid))
        .map(|p| p.rss_kb)
        .sum();

    let webview_pids = detect_nopes_webview_pids(&processes).unwrap_or_default();
    let webview_rss_kb: u64 = webview_pids
        .iter()
        .filter_map(|pid| by_pid.get(pid))
        .filter(|p| p.comm.to_lowercase().contains("webkit"))
        .map(|p| p.rss_kb)
        .sum();

    let ollama_rss_kb: u64 = processes
        .iter()
        .filter(|p| p.comm.to_lowercase().contains("ollama"))
        .map(|p| p.rss_kb)
        .sum();

    Ok(serde_json::json!({
        "app_mb": app_rss_kb / 1024,
        "webview_mb": webview_rss_kb / 1024,
        "ollama_mb": ollama_rss_kb / 1024,
    }))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ProcessStat {
    pid: u32,
    ppid: u32,
    rss_kb: u64,
    comm: String,
}

fn parse_process_line(line: &str) -> Option<ProcessStat> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let ppid = parts.next()?.parse::<u32>().ok()?;
    let rss_kb = parts.next()?.parse::<u64>().ok()?;
    let comm = parts.next()?.to_string();
    Some(ProcessStat { pid, ppid, rss_kb, comm })
}

fn parse_process_table(stdout: &str) -> Vec<ProcessStat> {
    stdout.lines().filter_map(parse_process_line).collect()
}

fn read_process_table() -> Result<Vec<ProcessStat>, String> {
    let output = Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid=,rss=,comm="])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(parse_process_table(&String::from_utf8_lossy(&output.stdout)))
}

fn collect_descendants(root_pid: u32, processes: &[ProcessStat]) -> HashSet<u32> {
    let mut by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in processes {
        by_parent.entry(p.ppid).or_default().push(p.pid);
    }

    let mut out = HashSet::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        if !out.insert(pid) {
            continue;
        }
        if let Some(children) = by_parent.get(&pid) {
            stack.extend(children);
        }
    }
    out
}

fn nopes_webkit_cache_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join("Library").join("Caches").join("nopes").join("WebKit"))
}

fn process_uses_cache_path(pid: u32, cache_path: &str) -> bool {
    let output = match Command::new("lsof")
        .arg("-nP")
        .arg("-p")
        .arg(pid.to_string())
        .output()
    {
        Ok(output) => output,
        Err(_) => return false,
    };
    String::from_utf8_lossy(&output.stdout).contains(cache_path)
}

fn detect_nopes_webview_pids(processes: &[ProcessStat]) -> Result<HashSet<u32>, String> {
    let cache_dir = match nopes_webkit_cache_dir() {
        Some(path) if path.exists() => path,
        _ => return Ok(HashSet::new()),
    };
    let cache_path = cache_dir.to_string_lossy().to_string();

    let mut pids = HashSet::new();
    for process in processes {
        if !process.comm.to_lowercase().contains("webkit") {
            continue;
        }
        if process_uses_cache_path(process.pid, &cache_path) {
            pids.insert(process.pid);
        }
    }
    Ok(pids)
}

/// Called from the frontend to verify model availability; returns "ok" or an error string.
#[tauri::command]
async fn ensure_model() -> Result<String, String> {
    let ollama_path = get_ollama_path();

    // Give ollama serve a moment to start if it was just launched
    std::thread::sleep(std::time::Duration::from_millis(800));

    let output = Command::new(&ollama_path)
        .args(["list"])
        .output()
        .map_err(|e| format!("Could not run {} list: {}", ollama_path, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();

    if stdout.contains("llama3.2:1b") {
        Ok("ok".to_string())
    } else {
        // Model not pulled yet, pull it silently
        let status = Command::new(&ollama_path)
            .args(["pull", "llama3.2:1b"])
            .status()
            .map_err(|e| format!("Could not run {} pull: {}", ollama_path, e))?;

        if status.success() {
            Ok("ok".to_string())
        } else {
            Err("Failed to pull llama3.2:1b".to_string())
        }
    }
}

/* ── Web Clipper: loopback-only, token-gated HTTP intake ──────
   The "server" never leaves the machine: bound to 127.0.0.1, OFF by
   default, and every request must carry the token the app generated.
   Clips are emitted to the frontend, which writes the note with its
   normal (permission-scoped) filesystem access. */

pub const CLIPPER_PORT: u16 = 21787;
const CLIPPER_MAX_BODY: usize = 2 * 1024 * 1024;

fn clip_response(status: u16, body: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = tiny_http::Response::from_string(body).with_status_code(status);
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "content-type, x-nopes-token"),
        ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ("Content-Type", "application/json"),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
    resp
}

fn clipper_apply(
    state: &Mutex<ClipperRuntime>,
    enabled: bool,
    port: u16,
    token: String,
    on_clip: impl Fn(serde_json::Value) + Send + 'static,
) -> Result<u16, String> {
    // One lock across the whole transition: concurrent calls (React StrictMode
    // double-mount, HMR effect re-runs) serialize instead of racing stop/bind.
    let mut rt = state.lock().map_err(|e| e.to_string())?;

    if let Some(server) = rt.server.take() {
        server.unblock(); // makes incoming_requests() return; thread exits
    }
    if let Some(thread) = rt.thread.take() {
        // The accept thread holds the last Arc to the server — joining it
        // guarantees the listening socket is closed before we bind again.
        let _ = thread.join();
    }
    if !enabled {
        return Ok(0);
    }
    if token.len() < 16 {
        return Err("Clipper token too short".into());
    }

    // The join above releases the port; retry briefly in case the OS lags.
    let mut bind = tiny_http::Server::http(("127.0.0.1", port));
    for _ in 0..19 {
        if bind.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
        bind = tiny_http::Server::http(("127.0.0.1", port));
    }
    let server = Arc::new(
        bind.map_err(|e| format!("Could not bind 127.0.0.1:{}: {}", port, e))?,
    );
    rt.server = Some(server.clone());

    rt.thread = Some(std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            if method == tiny_http::Method::Options {
                let _ = request.respond(clip_response(204, ""));
                continue;
            }
            let token_ok = request.headers().iter().any(|h| {
                h.field.as_str().as_str().eq_ignore_ascii_case("x-nopes-token")
                    && h.value.as_str() == token
            });
            if method != tiny_http::Method::Post || request.url() != "/clip" || !token_ok {
                let _ = request.respond(clip_response(403, "{\"error\":\"forbidden\"}"));
                continue;
            }
            let mut body = String::new();
            use std::io::Read;
            let mut limited = request.as_reader().take(CLIPPER_MAX_BODY as u64);
            if limited.read_to_string(&mut body).is_err() {
                let _ = request.respond(clip_response(400, "{\"error\":\"bad body\"}"));
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(payload) => {
                    on_clip(payload);
                    let _ = request.respond(clip_response(200, "{\"ok\":true}"));
                }
                Err(_) => {
                    let _ = request.respond(clip_response(400, "{\"error\":\"invalid json\"}"));
                }
            }
        }
        println!("[Nopes] Clipper server stopped.");
    }));

    Ok(port)
}

#[tauri::command]
fn set_clipper(enabled: bool, token: String, app: tauri::AppHandle) -> Result<u16, String> {
    let app_handle = app.clone();
    clipper_apply(
        &app.state::<ClipperServer>().0,
        enabled,
        CLIPPER_PORT,
        token,
        move |payload| {
            let _ = app_handle.emit("nopes:clip", payload);
        },
    )
}

/* ── Clip image mirroring ─────────────────────────────────────
   Remote images in clipped notes rot and leak a request on every
   note open. This downloads them into the vault's assets dir; the
   frontend rewrites the note to the returned local file names.
   Uses the system curl — same philosophy as the ollama/whisper
   integration: no bundled network stack. */

fn fnv1a_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", hash)
}

fn image_ext(content_type: &str, url: &str) -> Option<&'static str> {
    match content_type.split(';').next().unwrap_or("").trim() {
        "image/jpeg" => return Some("jpg"),
        "image/png" => return Some("png"),
        "image/gif" => return Some("gif"),
        "image/webp" => return Some("webp"),
        "image/svg+xml" => return Some("svg"),
        "image/avif" => return Some("avif"),
        "image/bmp" => return Some("bmp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => return Some("ico"),
        "image/tiff" => return Some("tiff"),
        _ => {}
    }
    // Content-type was unhelpful (e.g. application/octet-stream) — trust a
    // clearly image-like URL extension; anything else is not worth keeping.
    let path = url.split(['?', '#']).next().unwrap_or("");
    for (ext, canon) in [
        ("png", "png"), ("jpg", "jpg"), ("jpeg", "jpg"), ("gif", "gif"),
        ("webp", "webp"), ("svg", "svg"), ("avif", "avif"), ("bmp", "bmp"),
    ] {
        if path.to_ascii_lowercase().ends_with(&format!(".{}", ext)) {
            return Some(canon);
        }
    }
    None
}

fn download_one_image(url: &str, dest_dir: &std::path::Path) -> Option<String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    let stem = format!("clip-{}", fnv1a_hex(url));
    // The name is derived from the URL — an earlier download is still valid.
    if let Ok(entries) = std::fs::read_dir(dest_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(&stem) && !name.ends_with(".part") {
                return Some(name);
            }
        }
    }
    let tmp = dest_dir.join(format!("{}.part", stem));
    let out = std::process::Command::new("curl")
        .args([
            "-sSL", "--fail", "--max-time", "20", "--max-filesize", "15728640",
            "-A", "Mozilla/5.0 (Macintosh) NoPesClipper/1.0",
            "-o", tmp.to_str()?, "-w", "%{content_type}", url,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    let content_type = String::from_utf8_lossy(&out.stdout).to_string();
    let Some(ext) = image_ext(&content_type, url) else {
        let _ = std::fs::remove_file(&tmp); // an HTML error page, not an image
        return None;
    };
    let name = format!("{}.{}", stem, ext);
    std::fs::rename(&tmp, dest_dir.join(&name)).ok()?;
    Some(name)
}

fn mirror_clip_images(urls: &[String], dest_dir: &str) -> Result<Vec<Option<String>>, String> {
    let dir = std::path::PathBuf::from(dest_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // One curl per image, in parallel — a clip with many images should not
    // take images × latency.
    let results: Vec<Option<String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = urls
            .iter()
            .map(|url| {
                let dir = dir.clone();
                scope.spawn(move || download_one_image(url, &dir))
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or(None)).collect()
    });
    Ok(results)
}

#[tauri::command]
fn download_clip_images(urls: Vec<String>, dest_dir: String) -> Result<Vec<Option<String>>, String> {
    mirror_clip_images(&urls, &dest_dir)
}

/* ── Voice memos: local Whisper transcription ─────────────────
   Same discovery philosophy as Ollama: find a user-installed binary,
   never bundle. Model lives in the app data dir, downloaded on demand
   by the frontend. */

fn find_whisper_binary() -> Option<String> {
    let candidates = [
        "whisper-cli",
        "whisper-cpp",
        "/opt/homebrew/bin/whisper-cli",
        "/opt/homebrew/bin/whisper-cpp",
        "/usr/local/bin/whisper-cli",
        "/usr/local/bin/whisper-cpp",
    ];
    for c in candidates {
        if Command::new(c)
            .arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok()
        {
            return Some(c.to_string());
        }
    }
    None
}

fn whisper_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    Ok(dir.join("ggml-base.bin"))
}

#[tauri::command]
async fn check_whisper(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let model = whisper_model_path(&app)?;
    Ok(serde_json::json!({
        "binary": find_whisper_binary(),
        "model_present": model.exists(),
        "model_path": model.to_string_lossy(),
    }))
}

#[tauri::command]
async fn transcribe_audio(wav_path: String, app: tauri::AppHandle) -> Result<String, String> {
    let binary = find_whisper_binary()
        .ok_or("Whisper not found. Install it with: brew install whisper-cpp")?;
    let model = whisper_model_path(&app)?;
    if !model.exists() {
        return Err("Whisper model not downloaded yet — see Settings → General → Voice.".into());
    }

    // whisper.cpp is CPU/GPU heavy — keep it off the async runtime threads.
    let out = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&binary)
            .args([
                "-m", &model.to_string_lossy(),
                "-f", &wav_path,
                "-l", "auto",   // auto-detect language (German + English users!)
                "-np",           // no progress prints
                "-nt",           // no timestamps
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Could not run whisper: {}", e))?;

    if !out.status.success() {
        return Err(format!(
            "Whisper failed: {}",
            String::from_utf8_lossy(&out.stderr).chars().take(300).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_process_table_lines() {
        let input = "\
40234 1 388304 /System/Library/.../com.apple.WebKit.WebContent\n\
40186 40026 42848 target/debug/nopes\n";
        let parsed = parse_process_table(input);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].pid, 40234);
        assert_eq!(parsed[1].comm, "target/debug/nopes");
    }

    #[test]
    fn collects_descendants_of_root() {
        let processes = vec![
            ProcessStat { pid: 100, ppid: 1, rss_kb: 1, comm: "nopes".into() },
            ProcessStat { pid: 101, ppid: 100, rss_kb: 1, comm: "child".into() },
            ProcessStat { pid: 102, ppid: 101, rss_kb: 1, comm: "grandchild".into() },
            ProcessStat { pid: 200, ppid: 1, rss_kb: 1, comm: "other".into() },
        ];
        let out = collect_descendants(100, &processes);
        assert!(out.contains(&100));
        assert!(out.contains(&101));
        assert!(out.contains(&102));
        assert!(!out.contains(&200));
    }

    #[test]
    fn parses_single_process_line() {
        let line = "40186 40026 42848 target/debug/nopes";
        let process = parse_process_line(line).expect("process line should parse");
        assert_eq!(process.pid, 40186);
        assert_eq!(process.ppid, 40026);
        assert_eq!(process.rss_kb, 42848);
        assert_eq!(process.comm, "target/debug/nopes");
    }
}

#[cfg(test)]
mod clip_image_tests {
    use super::*;

    /// Serve fake image bytes so the download tests never touch the network.
    fn spawn_asset_server(port: u16) -> (Arc<tiny_http::Server>, std::thread::JoinHandle<()>) {
        let server = Arc::new(tiny_http::Server::http(("127.0.0.1", port)).expect("bind test server"));
        let srv = server.clone();
        let handle = std::thread::spawn(move || {
            for request in srv.incoming_requests() {
                let (status, ctype, body): (u16, &str, &[u8]) = match request.url() {
                    "/ok.png" => (200, "image/png", b"\x89PNG-fake-bytes"),
                    "/photo" => (200, "image/jpeg; charset=binary", b"\xff\xd8jpeg-fake"),
                    "/page" => (200, "text/html", b"<html>not an image</html>"),
                    _ => (404, "text/plain", b"nope"),
                };
                let mut resp = tiny_http::Response::from_data(body.to_vec()).with_status_code(status);
                if let Ok(h) = tiny_http::Header::from_bytes(b"Content-Type".as_ref(), ctype.as_bytes()) {
                    resp.add_header(h);
                }
                let _ = request.respond(resp);
            }
        });
        (server, handle)
    }

    #[test]
    fn mirrors_images_skips_non_images_and_reuses_downloads() {
        let port = 21793;
        let (server, handle) = spawn_asset_server(port);
        let dir = std::env::temp_dir().join(format!("nopes-clip-img-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let urls = vec![
            format!("http://127.0.0.1:{}/ok.png", port),
            format!("http://127.0.0.1:{}/photo", port),   // ext must come from content-type
            format!("http://127.0.0.1:{}/page", port),    // html → rejected
            format!("http://127.0.0.1:{}/missing.png", port), // 404 → rejected
            "not-a-url".to_string(),
        ];
        let names = mirror_clip_images(&urls, dir.to_str().unwrap()).expect("mirror");
        assert_eq!(names.len(), 5);

        let png = names[0].as_ref().expect("png downloaded");
        assert!(png.ends_with(".png"), "{}", png);
        assert_eq!(std::fs::read(dir.join(png)).unwrap(), b"\x89PNG-fake-bytes");

        let jpg = names[1].as_ref().expect("jpeg downloaded");
        assert!(jpg.ends_with(".jpg"), "{}", jpg);

        assert!(names[2].is_none(), "html must be rejected");
        assert!(names[3].is_none(), "404 must be rejected");
        assert!(names[4].is_none(), "invalid url must be rejected");

        // Same URL again → reused, no re-download needed.
        let again = mirror_clip_images(&urls[..1].to_vec(), dir.to_str().unwrap()).expect("mirror again");
        assert_eq!(again[0].as_deref(), Some(png.as_str()));

        // No stray .part files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
        server.unblock();
        let _ = handle.join();
    }
}

#[cfg(test)]
mod clipper_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::mpsc;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// Raw HTTP POST so the test exercises the real socket, not internals.
    fn post_clip(port: u16, token: &str, body: &str) -> String {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port))
            .unwrap_or_else(|e| panic!("no server listening on {}: {}", port, e));
        let req = format!(
            "POST /clip HTTP/1.1\r\nHost: 127.0.0.1\r\nX-NoPes-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(req.as_bytes()).expect("write request");
        let mut out = String::new();
        let _ = stream.read_to_string(&mut out);
        out
    }

    #[test]
    fn rebind_after_stop_succeeds() {
        // Settings toggle / Vite HMR: disable immediately followed by enable.
        let state = Mutex::new(ClipperRuntime::default());
        let port = 21790;
        clipper_apply(&state, true, port, TOKEN.into(), |_| {}).expect("first enable");
        clipper_apply(&state, false, port, TOKEN.into(), |_| {}).expect("disable");
        let r = clipper_apply(&state, true, port, TOKEN.into(), |_| {});
        assert!(r.is_ok(), "rebind after stop failed: {:?}", r);
        assert!(post_clip(port, TOKEN, "{}").starts_with("HTTP/1.1 200"));
        let _ = clipper_apply(&state, false, port, TOKEN.into(), |_| {});
    }

    #[test]
    fn concurrent_enables_leave_one_working_server() {
        // React StrictMode mounts the launch effect twice → two racing enables.
        let state = Arc::new(Mutex::new(ClipperRuntime::default()));
        let port = 21791;
        for round in 0..5 {
            let barrier = Arc::new(std::sync::Barrier::new(2));
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    let state = Arc::clone(&state);
                    let barrier = Arc::clone(&barrier);
                    std::thread::spawn(move || {
                        barrier.wait();
                        clipper_apply(&state, true, port, TOKEN.into(), |_| {})
                    })
                })
                .collect();
            for h in handles {
                let r = h.join().expect("enable thread panicked");
                assert!(r.is_ok(), "round {}: enable failed: {:?}", round, r);
            }
            let resp = post_clip(port, TOKEN, "{\"title\":\"t\"}");
            assert!(resp.starts_with("HTTP/1.1 200"), "round {}: server dead: {}", round, resp);
        }
        let _ = clipper_apply(&state, false, port, TOKEN.into(), |_| {});
    }

    #[test]
    fn clip_reaches_callback_and_bad_token_rejected() {
        let state = Mutex::new(ClipperRuntime::default());
        let port = 21792;
        let (tx, rx) = mpsc::channel();
        clipper_apply(&state, true, port, TOKEN.into(), move |v| {
            let _ = tx.send(v);
        })
        .expect("enable");
        assert!(post_clip(port, "wrong-token-wrong-token", "{}").starts_with("HTTP/1.1 403"));
        let resp = post_clip(port, TOKEN, "{\"title\":\"hello\"}");
        assert!(resp.starts_with("HTTP/1.1 200"), "{}", resp);
        let v = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("clip payload should reach callback");
        assert_eq!(v["title"], "hello");
        let _ = clipper_apply(&state, false, port, TOKEN.into(), |_| {});
    }
}
