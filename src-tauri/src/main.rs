// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::panic;
use std::fs::OpenOptions;
use std::io::Write;

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

fn main() {
    // Ensure panic logger is active
    init_panic_logger();
    println!("[Nopes] App starting...");
    
    nopes_lib::run();
}
