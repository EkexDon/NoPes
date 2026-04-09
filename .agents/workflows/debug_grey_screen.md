---
description: Debugging occasional grey screen crash in the Nopes Tauri app
---

## Steps to Diagnose and Fix the Grey Screen Crash

1. **Run the app in development mode with console output**
   ```bash
   cd /Users/ekex/Documents/Nopes
   npm run dev
   ```
   Observe the terminal for any panic messages from the Rust backend and the browser console for JavaScript errors.

2. **Enable Tauri devtools**
   - Open `src-tauri/src/lib.rs` and add the following line inside the `run` function before `.run(...)`:
   ```rust
   #[cfg(debug_assertions)]
   tauri::Builder::default().invoke_handler(tauri::generate_handler![ensure_model])
       .setup(|app| {
           #[cfg(debug_assertions)] {
               app.handle().open_devtools();
           }
           Ok(())
       })
       .run(tauri::generate_context!())
       .expect("error while running tauri application");
   ```
   This will open the Chromium devtools when the app starts, allowing you to see network failures or JS exceptions.

3. **Add a global Rust panic hook**
   - In `src-tauri/src/lib.rs` add at the top of the file:
   ```rust
   use std::panic;
   use std::fs::OpenOptions;
   use std::io::Write;
   
   fn init_panic_logger() {
       let log_path = std::path::Path::new("crash.log");
       let _ = OpenOptions::new().create(true).append(true).open(&log_path).map(|mut file| {
           panic::set_hook(Box::new(move |info| {
               let _ = writeln!(file, "--- PANIC ---\n{:?}\n", info);
           }));
       });
   }
   ```
   - Call `init_panic_logger();` at the beginning of the `run` function (before any other logic). This will write any Rust panic stack traces to `crash.log` in the project root.

4. **Capture JavaScript errors**
   - In `src/main.tsx` (or the entry point) add:
   ```tsx
   window.addEventListener('error', (e) => {
     console.error('Global JS error:', e.error);
   });
   window.addEventListener('unhandledrejection', (e) => {
     console.error('Unhandled promise rejection:', e.reason);
   });
   ```
   This ensures uncaught errors are logged to the dev console.

5. **Check the Tauri logs after a crash**
   - After reproducing the grey screen, open the file `crash.log` (created in step 3) to see if the Rust side panicked.
   - Also inspect the Chromium console (devtools) for any red error messages.

6. **Common culprits**
   - **Ollama process failing to start**: Verify the path detection in `get_ollama_path()` returns a valid executable. If not, the UI will stay in the `checking` state and may render a blank window.
   - **Missing assets**: Ensure `dist` folder exists after `npm run build`. If the app is launched without built assets, Tauri will show a grey screen.
   - **Window event handling**: The `on_window_event` listener only kills Ollama on `Destroyed`. If the window crashes before this, the process may linger. Consider adding a `tauri://error` listener:
   ```rust
   .on_window_event(|event| {
       if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
           // clean up before close
           api.prevent_close();
           // ...kill Ollama...
       }
   })
   ```

7. **Reproduce and record**
   - Run the app, trigger the scenario that leads to the grey screen, then capture the terminal output and devtools console.
   - Attach the `crash.log` file and console screenshots to the next message for further analysis.

---

**After performing these steps, share any error logs or screenshots** so we can pinpoint the exact failure point and apply a targeted fix.
