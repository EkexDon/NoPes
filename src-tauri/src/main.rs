// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command as StdCommand, Child};
use std::net::TcpListener;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::panic;
use std::fs::OpenOptions;
use std::io::Write;

static OLLAMA_CHILD: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

fn init_panic_logger() {
    let log_path = std::path::PathBuf::from("crash.log");
    panic::set_hook(Box::new(move |info| {
        // Open the log file on each panic (append mode)
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
            let _ = writeln!(file, "--- PANIC ---\n{:?}\n", info);
        } else {
            eprintln!("[Nopes] Failed to open crash.log for panic logging");
        }
    }));
}

fn start_ollama() {
    // Check if the Ollama port (11434) is already in use. If it is, assume Ollama is already running.
    match TcpListener::bind("127.0.0.1:11434") {
        Ok(listener) => {
            // Successfully bound, meaning nothing is listening yet. Drop the listener and continue.
            drop(listener);
        }
        Err(_) => {
            eprintln!("[Nopes] Port 11434 already in use – assuming Ollama is already running.");
            return;
        }
    }

    // Check if Ollama binary exists
    let has_ollama = StdCommand::new("which")
        .arg("ollama")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if has_ollama {
        // Spawn Ollama server if not already running
        let mut guard = OLLAMA_CHILD.lock().unwrap();
        if guard.is_none() {
            match StdCommand::new("ollama").arg("serve").spawn() {
                Ok(child) => {
                    *guard = Some(child);
                }
                Err(e) => {
                    eprintln!("Failed to start Ollama: {}", e);
                }
            }
        }
    } else {
        // Ollama not found – try bundled binary first, then fallback to script
        #[cfg(target_os = "macos")]
        {
            use std::path::Path;
            // Path relative to the executable binary
            let bundled_path = Path::new("../ollama/ollama");
            if bundled_path.exists() {
                // Start bundled Ollama
                match StdCommand::new(bundled_path).arg("serve").spawn() {
                    Ok(child) => {
                        let mut guard = OLLAMA_CHILD.lock().unwrap();
                        *guard = Some(child);
                    }
                    Err(e) => {
                        eprintln!("Failed to start bundled Ollama: {}", e);
                        // Fallback to script installation
                        let script_path = Path::new("../scripts/install_ollama.sh");
                        if script_path.exists() {
                            let _ = StdCommand::new("bash").arg(script_path).status();
                        } else {
                            eprintln!("[Nopes] Ollama not found: binary missing. Please reinstall the app.");
                        }
                    }
                }
            } else {
                // No bundled binary – try script installation
                let script_path = Path::new("../scripts/install_ollama.sh");
                if script_path.exists() {
                    let _ = StdCommand::new("bash").arg(script_path).status();
                } else {
                    eprintln!("[Nopes] Ollama not found: required for AI features. Please reinstall the app.");
                }
            }
        }
    }
}

fn stop_ollama() {
    let mut guard = OLLAMA_CHILD.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

fn main() {
    // Ensure panic logger is active
    init_panic_logger();
    println!("[Nopes] App started – devtools will be forced open");
    // Spawn a background thread that logs after 5 minutes of inactivity
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(300)); // 5 minutes
        eprintln!("[Nopes] Inactivity timeout reached – logging to crash.log");
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("crash.log")
            .and_then(|mut f| {
                use std::io::Write;
                writeln!(f, "[TIMEOUT] App idle for 5 minutes at {:?}", std::time::SystemTime::now())
            });
    });
    // Start Ollama in background if available
    start_ollama();
    // Start Ollama in background if available
    start_ollama();
    nopes_lib::run();
    // Clean up Ollama process on exit
    stop_ollama();
}
