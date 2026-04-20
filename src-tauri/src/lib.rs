use std::process::{Child, Command};
use std::sync::Mutex;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(OllamaProcess(Mutex::new(None)))
        .setup(move |app| {
            // Initial startup logic is handled by the frontend calling manage_ollama(true)
            // if AI is enabled in the user's settings.
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill ollama serve when the main window is destroyed
                stop_ollama_service(window.app_handle());
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
    let output = Command::new("ps")
        .args(["-ax", "-o", "rss,comm"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut nopes_rss = 0;
    let mut ollama_rss = 0;

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue; }
        let rss: u64 = parts[0].parse().unwrap_or(0);
        let comm = parts[1].to_lowercase();

        if comm.contains("nopes") || comm.contains("webkit") {
            nopes_rss += rss;
        } else if comm.contains("ollama") {
            ollama_rss += rss;
        }
    }

    Ok(serde_json::json!({
        "app_mb": nopes_rss / 1024,
        "ollama_mb": ollama_rss / 1024,
    }))
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

