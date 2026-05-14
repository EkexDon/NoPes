use std::process::{Child, Command};
use std::sync::Mutex;
use std::{collections::{HashMap, HashSet}, path::PathBuf};
use std::panic;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;

struct OllamaProcess(Mutex<Option<Child>>);

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
        .manage(OllamaProcess(Mutex::new(None)))
        .setup(move |_app| {
            // Initial startup logic is handled by the frontend calling manage_ollama(true)
            // if AI is enabled in the user's settings.
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Destroyed => {
                    // Kill ollama serve when the main window is destroyed
                    stop_ollama_service(window.app_handle());
                }
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Also clean up Ollama on close request (catches cases where
                    // Destroyed doesn't fire, e.g. app crashes mid-transition)
                    stop_ollama_service(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![ensure_model, manage_ollama, get_system_stats])
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
