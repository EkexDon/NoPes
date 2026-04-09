use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct OllamaProcess(Mutex<Option<Child>>);

fn get_ollama_path() -> String {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ollama_path = get_ollama_path();
    let _ollama_path_clone = ollama_path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(OllamaProcess(Mutex::new(None)))
        .setup(move |app| {
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

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill ollama serve when the main window is destroyed
                let state = window.state::<OllamaProcess>();
                let child_opt = state.0.lock().ok().and_then(|mut g| g.take());
                if let Some(mut child) = child_opt {
                    let _ = child.kill();
                    println!("[Nopes] ollama serve stopped.");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![ensure_model])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

